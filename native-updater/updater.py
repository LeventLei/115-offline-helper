#!/usr/bin/env python3
"""115 助手更新器：只操作登记的扩展目录，不读取浏览器配置或凭据。"""
import argparse
import base64
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urlparse
import zipfile

HOST = 'com.leventlei.push115_updater'
REPO = 'LeventLei/115-offline-helper'
NAME = 'Levent 115 离线助手'
SUPPORT = Path.home() / 'Library' / 'Application Support' / 'Levent115Updater'
MAX_BYTES = 20 * 1024 * 1024
ALLOWED_HOSTS = {'api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}


class UpdateError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def version(raw):
    if not isinstance(raw, str) or not re.fullmatch(r'v?\d+(?:\.\d+){0,3}', raw):
        raise UpdateError('INVALID_VERSION', '发行版本格式无效')
    parts = tuple(int(item) for item in raw.removeprefix('v').split('.'))
    if any(item > 65535 for item in parts):
        raise UpdateError('INVALID_VERSION', '发行版本格式无效')
    return parts + (0,) * (4 - len(parts))


def allowed_url(raw):
    parsed = urlparse(raw)
    return parsed.scheme == 'https' and parsed.hostname in ALLOWED_HOSTS and not parsed.username and not parsed.password and parsed.port in (None, 443)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise UpdateError('INVALID_URL', '下载跳转地址不在允许范围内')
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def fetch_bytes(url, limit=MAX_BYTES):
    if not allowed_url(url):
        raise UpdateError('INVALID_URL', '下载地址不在允许范围内')
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Levent115Updater/1.0', 'Accept': 'application/vnd.github+json'})
        with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise UpdateError('TOO_LARGE', '下载文件超过大小限制')
        return data
    except UpdateError:
        raise
    except Exception:
        raise UpdateError('NETWORK', '无法连接GitHub，请稍后重试') from None


def managed_file(name):
    path = PurePosixPath(name)
    return bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', name)) and (
        name in {'manifest.json', 'README.md'} or
        (len(path.parts) == 1 and path.suffix in {'.js', '.css', '.html'}) or
        (path.parts[0] == 'icons' and path.suffix in {'.png', '.svg'})
    )


def extension_id_for(folder, manifest):
    try:
        raw = base64.b64decode(manifest['key'], validate=True) if manifest.get('key') else str(folder).encode()
        return ''.join(chr(97 + int(char, 16)) for char in hashlib.sha256(raw).hexdigest()[:32])
    except Exception:
        raise UpdateError('IDENTITY_CHANGED', '扩展公钥格式无效') from None


def read_manifest(folder):
    try:
        manifest = json.loads((folder / 'manifest.json').read_text())
        if manifest.get('name') != NAME or manifest.get('manifest_version') != 3:
            raise ValueError()
        version(manifest['version'])
        return manifest
    except Exception:
        raise UpdateError('INVALID_TARGET', '目录不是有效的115助手扩展') from None


def select_release(releases):
    candidates = []
    for item in releases:
        if item.get('draft') or item.get('prerelease'):
            continue
        try:
            v = version(item.get('tag_name'))
        except UpdateError:
            continue
        candidates.append((v, item))
    if not candidates:
        raise UpdateError('NO_RELEASE', '未找到可用正式版本')
    item = max(candidates, key=lambda pair: pair[0])[1]
    tag_version = item['tag_name'].removeprefix('v')
    names = {f'levent-115-offline-helper_v{tag_version}.zip', f'levent-115-offline-helper-v{tag_version}.zip'}
    assets = [a for a in item.get('assets', []) if a.get('name') in names and a.get('state') == 'uploaded']
    if len(assets) != 1:
        raise UpdateError('NO_ASSET', '正式版本缺少唯一的扩展安装包')
    asset = assets[0]
    digest = asset.get('digest')
    if not isinstance(digest, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise UpdateError('NO_DIGEST', '发行包缺少SHA256摘要，无法更新')
    prefix = f'https://github.com/{REPO}/releases/download/{item["tag_name"]}/'
    if not asset.get('browser_download_url', '').startswith(prefix):
        raise UpdateError('INVALID_URL', '发行包地址不属于指定仓库')
    return {'version': tag_version, 'url': asset['browser_download_url'], 'digest': digest.split(':')[1]}


def latest_release():
    try:
        releases = json.loads(fetch_bytes(f'https://api.github.com/repos/{REPO}/releases?per_page=100', 2 * 1024 * 1024))
        return select_release(releases)
    except UpdateError:
        raise
    except Exception:
        raise UpdateError('INVALID_RELEASE', 'GitHub发行数据无法解析') from None


def unpack(data, folder, expected, old_manifest):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
        if len(entries) > 200 or sum(i.file_size for i in entries) > MAX_BYTES:
            raise ValueError()
        seen = set()
        for item in entries:
            path = PurePosixPath(item.filename)
            key = item.filename.rstrip('/').lower()
            if path.as_posix() != item.filename.rstrip('/') or path.is_absolute() or '..' in path.parts or '\\' in item.filename or key in seen or stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError()
            seen.add(key)
            if item.is_dir():
                if item.filename.rstrip('/') != 'icons':
                    raise ValueError()
                continue
            if not managed_file(item.filename):
                raise ValueError()
            target = folder.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(item))
        manifest = read_manifest(folder)
        if version(manifest['version']) != version(expected) or (manifest.get('key') is not None and manifest.get('key') != old_manifest.get('key')):
            raise UpdateError('IDENTITY_CHANGED', '版本或扩展标识不一致，已取消更新')
        if old_manifest.get('key') is not None and manifest.get('key') is None:
            manifest['key'] = old_manifest['key']
            (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for field in ('permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions'):
            if not set(manifest.get(field, [])).issubset(set(old_manifest.get(field, []))):
                raise UpdateError('PERMISSION_CHANGED', '新版增加了权限，需要手动确认后原位安装')
        required = [manifest['background']['service_worker'], manifest['action']['default_popup']]
        required += list(manifest.get('icons', {}).values())
        required += [name for script in manifest.get('content_scripts', []) for name in script.get('js', []) + script.get('css', [])]
        # 检查实际入口引用的本地文件，避免只剩manifest而入口依赖缺失。
        worker = folder / manifest['background']['service_worker']
        if worker.is_file():
            for arguments in re.findall(r'importScripts\(([^)]+)\)', worker.read_text()):
                required += re.findall(r"['\"]([^'\"]+)['\"]", arguments)
        popup = folder / manifest['action']['default_popup']
        if popup.is_file():
            required += [name for name in re.findall(r'(?:src|href)=[\"\']([^\"\']+)[\"\']', popup.read_text()) if not name.startswith(('http:', 'https:', '#', 'data:'))]
        for name in required:
            if not isinstance(name, str) or not managed_file(name) or not (folder / name).is_file():
                raise ValueError()
        return manifest
    except UpdateError:
        raise
    except Exception:
        raise UpdateError('INVALID_ZIP', '安装包内容不完整或包含非法文件') from None


def private_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(data, stream)
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class Updater:
    def __init__(self, support=SUPPORT, require_manifest=True):
        self.support = Path(support)
        try:
            config = json.loads((self.support / 'config.json').read_text())
            self.extension_id = config['extension_id']
            self.target = Path(config['extension_dir'])
            if not re.fullmatch(r'[a-p]{32}', self.extension_id) or not self.target.is_absolute() or self.target.is_symlink():
                raise ValueError()
            if require_manifest:
                current = read_manifest(self.target)
                if extension_id_for(self.target, current) != self.extension_id:
                    raise ValueError()
        except Exception:
            raise UpdateError('NOT_CONFIGURED', '助手尚未安装或登记目录无效') from None

    @contextlib.contextmanager
    def lock(self):
        with (self.support / 'update.lock').open('a') as stream:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise UpdateError('BUSY', '另一个更新操作正在运行') from None
            yield

    def state(self):
        try:
            return json.loads((self.support / 'state.json').read_text())
        except FileNotFoundError:
            return {}
        except Exception:
            raise UpdateError('INVALID_STATE', '更新状态损坏，请运行助手修复安装') from None

    def status(self):
        state = self.state()
        return {'current_version': read_manifest(self.target)['version'], 'backup_available': (self.support / 'backup' / 'manifest.json').is_file(),
                'pending_version': state.get('pending_version'), 'protocol': 1}

    def check(self):
        result = self.status()
        release = latest_release()
        result.update({'latest_version': release['version'], 'update_available': version(release['version']) > version(result['current_version'])})
        return result

    def install(self):
        with self.lock():
            if self.state().get('pending_version'):
                raise UpdateError('PENDING_RELOAD', '上次更新尚未确认，请先重新加载插件')
            old = read_manifest(self.target)
            release = latest_release()
            if version(release['version']) <= version(old['version']):
                return {'installed': False, 'current_version': old['version']}
            data = fetch_bytes(release['url'])
            if hashlib.sha256(data).hexdigest() != release['digest']:
                raise UpdateError('HASH_MISMATCH', '下载摘要不匹配，原插件未改动')
            with tempfile.TemporaryDirectory(prefix='.115-update-', dir=self.target.parent) as staging:
                staging = Path(staging)
                staged = staging / 'new'
                staged.mkdir()
                unpack(data, staged, release['version'], old)
                # 只备份受管理的发行文件；不读取浏览器的存储或Cookie。
                files = []
                for path in self.target.rglob('*'):
                    if path.is_symlink():
                        raise UpdateError('UNMANAGED_FILE', '原扩展目录含链接文件，请先检查')
                    if path.is_file():
                        rel = path.relative_to(self.target).as_posix()
                        if rel == '.DS_Store':
                            continue
                        if not managed_file(rel):
                            raise UpdateError('UNMANAGED_FILE', '原扩展目录含额外文件，请先移出后更新')
                        files.append((path, rel))
                backup = self.support / 'backup'
                backup_temp = self.support / 'backup-next'
                if backup_temp.exists():
                    shutil.rmtree(backup_temp)
                backup_temp.mkdir(mode=0o700)
                for path, rel in files:
                    dest = backup_temp / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, dest)
                previous = staging / 'previous'
                moved = False
                try:
                    os.replace(self.target, previous)
                    moved = True
                    os.replace(staged, self.target)
                    if backup.exists():
                        shutil.rmtree(backup)
                    os.replace(backup_temp, backup)
                    private_json(self.support / 'state.json', {'pending_version': release['version'], 'previous_version': old['version']})
                except Exception:
                    if moved:
                        if self.target.exists():
                            shutil.rmtree(self.target)
                        os.replace(previous, self.target)
                    raise UpdateError('INSTALL_FAILED', '替换失败，已恢复原插件文件') from None
            return {'installed': True, 'current_version': release['version'], 'reload_required': True}

    def confirm(self, running_version):
        with self.lock():
            version(running_version)
            if version(running_version) != version(read_manifest(self.target)['version']):
                raise UpdateError('VERSION_MISMATCH', '插件运行版本与磁盘版本不同，请重新加载')
            state = self.state()
            if state.get('pending_version') and version(state['pending_version']) != version(running_version):
                raise UpdateError('VERSION_MISMATCH', '更新版本尚未成功启动')
            private_json(self.support / 'state.json', {})
            return self.status()

    def restore(self):
        with self.lock():
            backup = self.support / 'backup'
            old = read_manifest(backup)
            current = read_manifest(self.target) if self.target.exists() else old
            if old.get('key') != current.get('key'):
                raise UpdateError('IDENTITY_CHANGED', '备份的扩展标识不一致')
            with tempfile.TemporaryDirectory(prefix='.115-update-', dir=self.target.parent) as temp:
                staged = Path(temp) / 'restored'
                shutil.copytree(backup, staged)
                previous = Path(temp) / 'previous'
                if self.target.exists():
                    os.replace(self.target, previous)
                try:
                    os.replace(staged, self.target)
                    private_json(self.support / 'state.json', {})
                except Exception:
                    if self.target.exists():
                        shutil.rmtree(self.target)
                    if previous.exists():
                        os.replace(previous, self.target)
                    raise UpdateError('RESTORE_FAILED', '恢复失败，已保留更新前文件') from None
            return {'restored': True, 'current_version': old['version']}


def handle(updater, message):
    if not isinstance(message, dict) or message.get('protocol') != 1:
        raise UpdateError('INVALID_MESSAGE', '更新消息格式无效')
    action = message.get('action')
    keys = {'protocol', 'action', 'version'} if action == 'confirm' else {'protocol', 'action'}
    if set(message) - keys:
        raise UpdateError('INVALID_MESSAGE', '更新消息包含不支持的参数')
    if action == 'check':
        return updater.check()
    if action == 'install':
        return updater.install()
    if action == 'status':
        return updater.status()
    if action == 'confirm':
        return updater.confirm(message.get('version'))
    raise UpdateError('INVALID_ACTION', '不支持此更新操作')


def serve(origin, source=None, destination=None):
    source = source or sys.stdin.buffer
    destination = destination or sys.stdout.buffer
    try:
        updater = Updater()
        if origin != f'chrome-extension://{updater.extension_id}/':
            raise UpdateError('FORBIDDEN', '扩展来源不匹配')
        header = source.read(4)
        if len(header) != 4:
            return
        size = struct.unpack('=I', header)[0]
        if not 0 < size <= 65536:
            raise UpdateError('INVALID_MESSAGE', '更新消息超过限制')
        raw = source.read(size)
        if len(raw) != size:
            raise UpdateError('INVALID_MESSAGE', '更新消息不完整')
        response = {'success': True, 'data': handle(updater, json.loads(raw))}
    except UpdateError as error:
        response = {'success': False, 'code': error.code, 'error': str(error)}
    except Exception:
        response = {'success': False, 'code': 'FAILED', 'error': '本地更新失败，请检查助手安装'}
    raw = json.dumps(response, ensure_ascii=False).encode()
    destination.write(struct.pack('=I', len(raw)) + raw)
    destination.flush()


def install_host(target, extension_id):
    if sys.platform != 'darwin':
        raise UpdateError('UNSUPPORTED', '当前助手安装器仅支持macOS Chrome')
    if not re.fullmatch(r'[a-p]{32}', extension_id):
        raise UpdateError('INVALID_ID', '扩展ID应为32位小写字母a到p')
    target = Path(target).expanduser().resolve()
    current = read_manifest(target)
    if extension_id_for(target, current) != extension_id:
        raise UpdateError('INVALID_ID_PATH', '扩展ID与目录不匹配，请输入Chrome详情页的实际加载目录')
    SUPPORT.mkdir(parents=True, exist_ok=True, mode=0o700)
    SUPPORT.chmod(0o700)
    existing = SUPPORT / 'config.json'
    if existing.exists():
        config = json.loads(existing.read_text())
        if config != {'extension_dir': str(target), 'extension_id': extension_id}:
            # 仅允许修复同一ID的无效旧登记；有效其他目标仍须人工核对。
            try:
                old_folder = Path(config['extension_dir'])
                old_matches = extension_id_for(old_folder, read_manifest(old_folder)) == extension_id
            except UpdateError:
                old_matches = False
            if config.get('extension_id') != extension_id or old_matches or (SUPPORT / 'backup').exists():
                raise UpdateError('ALREADY_CONFIGURED', '助手已登记其他目录或ID，请先核对原安装信息')
    program = SUPPORT / 'updater.py'
    if Path(__file__).resolve() != program.resolve():
        shutil.copy2(__file__, program)
    import shlex
    launcher = SUPPORT / 'native-host.command'
    launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(program)) + ' --native "$@"\n')
    launcher.chmod(0o700)
    private_json(existing, {'extension_dir': str(target), 'extension_id': extension_id})
    manifest_dir = Path.home() / 'Library' / 'Application Support' / 'Google' / 'Chrome' / 'NativeMessagingHosts'
    private_json(manifest_dir / (HOST + '.json'), {'name': HOST, 'description': 'Levent 115 local updater', 'path': str(launcher),
                'type': 'stdio', 'allowed_origins': [f'chrome-extension://{extension_id}/']})
    restore = SUPPORT / 'Restore.command'
    restore.write_text('#!/bin/sh\n' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(program)) + ' --restore\nread -r _\n')
    restore.chmod(0o700)
    print('助手安装完成。首次请原位安装1.3.0、重新加载插件，再到设置页检查更新。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--extension-dir')
    parser.add_argument('--extension-id')
    parser.add_argument('--restore', action='store_true')
    parser.add_argument('--native', action='store_true')
    parser.add_argument('origin', nargs='?')
    args = parser.parse_args()
    if args.native:
        serve(args.origin)
        return
    try:
        if args.install:
            directory = args.extension_dir or input('原扩展目录（包含manifest.json，可将目录拖入终端）：').strip().strip("'\"")
            extension_id = args.extension_id or input('扩展详情页的32位ID：').strip()
            install_host(directory, extension_id)
        elif args.restore:
            Updater(require_manifest=False).restore()
            print('已恢复上一版，请在Chrome扩展管理页重新加载插件。')
        else:
            parser.print_help()
    except UpdateError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('操作失败，请检查本机助手安装和目录权限。', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
