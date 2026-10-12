import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import tempfile
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location('updater', Path(__file__).parents[1] / 'updater.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)


def manifest(ver='1.3.0', key=None):
    data = {'manifest_version': 3, 'name': u.NAME, 'version': ver,
            'permissions': ['nativeMessaging'], 'host_permissions': ['https://115.com/*'],
            'background': {'service_worker': 'background.js'}, 'action': {'default_popup': 'popup.html'}}
    if key is not None:
        data['key'] = key
    return data


def bundle(ver='1.4.0', extras=None, config=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as archive:
        archive.writestr('manifest.json', json.dumps(config or manifest(ver)))
        archive.writestr('background.js', '// version ' + ver)
        archive.writestr('popup.html', '<p>115</p>')
        for name, data in (extras or {}).items():
            archive.writestr(name, data)
    return buf.getvalue()


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.target = self.root / 'extension'
        self.target.mkdir()
        self.support = self.root / 'helper'
        self.support.mkdir()
        for name, data in {'manifest.json': json.dumps(manifest()), 'background.js': '// old', 'popup.html': '<p>old</p>'}.items():
            (self.target / name).write_text(data)
        u.private_json(self.support / 'config.json', {'extension_dir': str(self.target), 'extension_id': u.extension_id_for(self.target, manifest())})
        self.client = u.Updater(self.support)
        self.data = bundle()
        self.release = {'version': '1.4.0', 'url': 'https://github.com/' + u.REPO + '/releases/download/v1.4.0/file.zip',
                        'digest': hashlib.sha256(self.data).hexdigest()}

    def tearDown(self):
        self.temp.cleanup()

    def install(self):
        with mock.patch.object(u, 'latest_release', return_value=self.release), mock.patch.object(u, 'fetch_bytes', return_value=self.data):
            return self.client.install()

    def test_path_input_formats(self):
        expected = Path.home() / 'Library/Application Support/test extension'
        for raw in ['~/资源库/Application Support/test extension',
                    "'~/Library/Application Support/test extension'",
                    '~/Library/Application\\ Support/test\\ extension',
                    str(Path.home() / '资源库/Application Support/test extension')]:
            self.assertEqual(u.normalize_target(raw), expected.resolve())
        with self.assertRaises(u.UpdateError):
            u.normalize_target("'unfinished")
        with self.assertRaises(u.UpdateError):
            u.normalize_target("'one' 'two'")

    def test_permission_denial_is_distinct_and_redacted(self):
        with mock.patch.object(Path, 'read_text', side_effect=PermissionError(1, 'private detail')):
            for check in [lambda: u.read_manifest(self.target), lambda: u.Updater(self.support)]:
                with self.assertRaises(u.UpdateError) as caught:
                    check()
                self.assertEqual(caught.exception.code, 'PERMISSION_DENIED')
                self.assertNotIn('private detail', str(caught.exception))
        original = Path.read_text
        def deny_manifest(path, *args, **kwargs):
            if path.name == 'manifest.json':
                raise PermissionError(1, 'private detail')
            return original(path, *args, **kwargs)
        with mock.patch.object(Path, 'read_text', deny_manifest):
            with self.assertRaises(u.UpdateError) as caught:
                u.Updater(self.support)
            self.assertEqual(caught.exception.code, 'PERMISSION_DENIED')

    def test_permission_error_reaches_native_client(self):
        destination = io.BytesIO()
        with mock.patch.object(u, 'Updater', side_effect=u.permission_error()):
            u.serve('chrome-extension://placeholder/', io.BytesIO(), destination)
        raw = destination.getvalue()
        size = struct.unpack('=I', raw[:4])[0]
        response = json.loads(raw[4:4 + size])
        self.assertFalse(response['success'])
        self.assertEqual(response['code'], 'PERMISSION_DENIED')
        self.assertIn('macOS', response['error'])

    def test_numeric_version(self):
        self.assertGreater(u.version('1.10.0'), u.version('1.9.9'))
        self.assertEqual(u.version('v1.3'), u.version('1.3.0'))
        for value in ['bad', '1.3-beta', '', None, '999999.0']:
            with self.assertRaises(u.UpdateError):
                u.version(value)

    def test_select_highest_stable_release_not_helper_zip(self):
        def release(tag, draft=False, prerelease=False):
            return {'tag_name': tag, 'draft': draft, 'prerelease': prerelease, 'assets': [{
                'name': f'levent-115-offline-helper_{tag}.zip', 'state': 'uploaded', 'digest': 'sha256:' + 'a' * 64,
                'browser_download_url': f'https://github.com/{u.REPO}/releases/download/{tag}/extension.zip'}]}
        selected = u.select_release([release('v1.3.0'), release('v1.10.0'), release('v2.0.0', prerelease=True), release('v3.0.0', draft=True)])
        self.assertEqual(selected['version'], '1.10.0')
        with self.assertRaises(u.UpdateError):
            u.select_release([{'tag_name': 'v1.3.0', 'assets': []}])

    def test_network_error_and_redirect_allowlist(self):
        with mock.patch.object(u.urllib.request, 'build_opener', side_effect=OSError('private detail')):
            with self.assertRaisesRegex(u.UpdateError, '无法连接'):
                u.fetch_bytes('https://api.github.com/repos/test')
        for url in ['http://github.com/file', 'https://evil.test/file', 'https://github.com:444/file']:
            self.assertFalse(u.allowed_url(url))
        self.assertTrue(u.allowed_url('https://release-assets.githubusercontent.com/file'))

    def test_install_keeps_path_and_external_preferences(self):
        prefs = self.root / 'browser-preferences.json'
        prefs.write_text('{"theme":"dark","destination":"123456789"}')
        original = prefs.read_bytes()
        path = str(self.target)
        self.assertTrue(self.install()['installed'])
        self.assertEqual(str(self.client.target), path)
        self.assertEqual(u.read_manifest(self.target)['version'], '1.4.0')
        self.assertEqual(prefs.read_bytes(), original)
        self.assertEqual(u.read_manifest(self.support / 'backup')['version'], '1.3.0')
        self.assertEqual(self.client.state()['pending_version'], '1.4.0')
        self.client.confirm('1.4.0')
        self.assertEqual(self.client.state(), {})

    def test_no_update_does_not_download_or_modify(self):
        self.release['version'] = '1.3.0'
        with mock.patch.object(u, 'latest_release', return_value=self.release), mock.patch.object(u, 'fetch_bytes') as fetch:
            self.assertFalse(self.client.install()['installed'])
            fetch.assert_not_called()

    def test_checksum_failure_keeps_original(self):
        self.release['digest'] = '0' * 64
        with self.assertRaisesRegex(u.UpdateError, '摘要不匹配'):
            self.install()
        self.assertEqual(u.read_manifest(self.target)['version'], '1.3.0')
        self.assertFalse((self.support / 'backup').exists())

    def test_archive_paths_symlinks_and_case_collisions(self):
        for path in ['../escape.js', '/escape.js', 'icons/../../escape.js', 'cookie.json', 'node_modules/a.js', 'POPUP.HTML', 'icons/./a.png', 'icons//a.png']:
            with self.subTest(path=path):
                with self.assertRaises(u.UpdateError):
                    u.unpack(bundle(extras={path: 'bad'}), self.root / 'staging', '1.4.0', manifest())
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            item = zipfile.ZipInfo('popup.html')
            item.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(item, 'outside')
        with self.assertRaises(u.UpdateError):
            u.unpack(buf.getvalue(), self.root / 'staging', '1.4.0', manifest())
        self.assertFalse((self.root / 'escape.js').exists())

    def test_changed_identity_version_and_permissions_rejected(self):
        for config in [manifest(key='changed'), manifest('1.5.0'), {**manifest('1.4.0'), 'permissions': ['nativeMessaging', 'history']}]:
            with self.assertRaises(u.UpdateError):
                u.unpack(bundle(config=config), self.root / 'staging', '1.4.0', manifest())

    def test_missing_files_and_bad_zip(self):
        for data in [b'not zip', bundle(config={**manifest('1.4.0'), 'background': {'service_worker': 'missing.js'}})]:
            with self.assertRaises(u.UpdateError):
                u.unpack(data, self.root / 'staging', '1.4.0', manifest())

    def test_unmanaged_target_not_backed_up_or_deleted(self):
        private = self.target / 'credentials.json'
        private.write_text('local only')
        with self.assertRaisesRegex(u.UpdateError, '额外文件'):
            self.install()
        self.assertEqual(private.read_text(), 'local only')
        self.assertFalse((self.support / 'backup' / 'credentials.json').exists())

    def test_replace_failure_rolls_back(self):
        original = u.os.replace
        def fail_new(source, dest):
            if Path(source).name == 'new':
                raise OSError('write error')
            return original(source, dest)
        with mock.patch.object(u.os, 'replace', side_effect=fail_new):
            with self.assertRaisesRegex(u.UpdateError, '已恢复'):
                self.install()
        self.assertEqual(u.read_manifest(self.target)['version'], '1.3.0')
        self.assertEqual((self.target / 'background.js').read_text(), '// old')

    def test_confirmation_blocks_repeat_updates_and_restore(self):
        self.install()
        with self.assertRaisesRegex(u.UpdateError, '尚未确认'):
            self.install()
        with self.assertRaises(u.UpdateError):
            self.client.confirm('1.3.0')
        self.assertTrue(self.client.restore()['restored'])
        self.assertEqual(u.read_manifest(self.target)['version'], '1.3.0')
        self.assertEqual(self.client.state(), {})

    def test_concurrent_install_lock(self):
        with self.client.lock():
            with self.assertRaisesRegex(u.UpdateError, '另一个更新'):
                self.install()

    def test_message_rejects_path_url_and_command(self):
        for message in [{'protocol':1,'action':'check','url':'https://evil.test'}, {'protocol':1,'action':'install','path':'outside'}, {'protocol':1,'action':'shell'}, {'protocol':2,'action':'check'}]:
            with self.assertRaises(u.UpdateError):
                u.handle(self.client, message)

    def test_native_framing_origin_and_no_sensitive_response(self):
        for origin, success in [('chrome-extension://' + self.client.extension_id + '/', True), ('chrome-extension://' + 'b'*32 + '/', False)]:
            raw = json.dumps({'protocol':1,'action':'status'}).encode()
            destination = io.BytesIO()
            with mock.patch.object(u, 'Updater', return_value=self.client):
                u.serve(origin, io.BytesIO(struct.pack('=I', len(raw)) + raw), destination)
            result = destination.getvalue()
            self.assertEqual(struct.unpack('=I', result[:4])[0], len(result)-4)
            parsed = json.loads(result[4:])
            self.assertEqual(parsed['success'], success)
            self.assertNotIn(str(self.target), result.decode(errors='ignore'))
            self.assertNotIn(self.client.extension_id, result.decode(errors='ignore'))

    def test_restore_when_target_missing_after_interruption(self):
        self.install()
        import shutil
        shutil.rmtree(self.target)
        client = u.Updater(self.support, require_manifest=False)
        self.assertTrue(client.restore()['restored'])
        self.assertEqual(u.read_manifest(self.target)['version'], '1.3.0')

    def test_missing_key_preserves_local_extension_identity(self):
        folder = self.root / 'public-key-stage'
        folder.mkdir()
        config = manifest()
        config['key'] = 'cHVibGljLWtleQ=='
        u.unpack(bundle(), folder, '1.4.0', config)
        self.assertEqual(u.read_manifest(folder)['key'], config['key'])

    def test_wrong_id_directory_is_rejected(self):
        u.private_json(self.support / 'config.json', {'extension_dir': str(self.target), 'extension_id': 'b' * 32})
        with self.assertRaises(u.UpdateError):
            u.Updater(self.support)

    def test_private_config_mode(self):
        self.assertEqual(stat.S_IMODE((self.support / 'config.json').stat().st_mode), 0o600)
