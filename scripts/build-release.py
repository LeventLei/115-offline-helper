#!/usr/bin/env python3
"""构建扩展与助手发行包，禁止打包本机登记文件或编译缓存。"""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'extension/manifest.json').read_text())
version = manifest['version']
assert json.loads((root / 'package.json').read_text())['version'] == version
out = root / 'dist'
out.mkdir(exist_ok=True)
packages = {
    f'levent-115-offline-helper_v{version}.zip': [(p, p.relative_to(root / 'extension').as_posix()) for p in (root / 'extension').rglob('*') if p.is_file()],
    f'levent-115-updater_macos_v{version}.zip': [(root / 'native-updater' / name, name) for name in ['updater.py', 'Install.command', 'README.md']],
}
for filename, files in packages.items():
    target = out / filename
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for source, name in sorted(files):
            assert '__pycache__' not in source.parts and source.suffix != '.pyc'
            data = source.read_bytes()
            scan = subprocess.run(['python3', str(root / 'scripts/check-privacy.py'), '--stdin'], input=data, capture_output=True, cwd=root)
            if scan.returncode:
                raise RuntimeError('发行文件隐私检查失败：' + name)
            archive.write(source, name)
    with zipfile.ZipFile(target) as archive:
        assert not any(name.endswith(('config.json', 'state.json', '.pyc')) for name in archive.namelist())
        if 'manifest.json' in archive.namelist():
            assert json.loads(archive.read('manifest.json'))['version'] == version
            assert 'nativeMessaging' in json.loads(archive.read('manifest.json'))['permissions']
    print(filename, hashlib.sha256(target.read_bytes()).hexdigest())
