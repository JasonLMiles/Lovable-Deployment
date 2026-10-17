import importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('package',Path(__file__).parents[1]/'scripts/package.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Packaging(unittest.TestCase):
    def make_root(self, root, stack):
        (root/'azure/runtime').mkdir(parents=True)
        (root/'azure/runtime/server.mjs').write_text('// runtime')
        dependencies={'@tanstack/react-start':'1'} if stack=='tanstack' else {'vite':'1'}
        (root/'package.json').write_text(json.dumps({'dependencies':dependencies}))
        target=root/('.output/server/index.mjs' if stack=='tanstack' else 'dist/index.html')
        target.parent.mkdir(parents=True)
        target.write_text('built output')
        (root/'.env').write_text('MUST_NOT_SHIP=secret')
        (root/'source.ts').write_text('source should not ship')
    def test_both_artifact_shapes_and_exclusions(self):
        for stack in ['vite','tanstack']:
            with self.subTest(stack=stack),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.make_root(root,stack)
                module.package(root,root/'release/app.zip','a'*40)
                with zipfile.ZipFile(root/'release/app.zip') as archive:
                    self.assertNotIn('.env',archive.namelist())
                    self.assertNotIn('source.ts',archive.namelist())
                    self.assertEqual(json.loads(archive.read('release.json'))['stack'],stack)
                    self.assertIn('azure/runtime/server.mjs',archive.namelist())
                self.assertTrue((root/'release/app.sha256').is_file())
    def test_rejects_environment_files_in_build_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.make_root(root,'vite')
            (root/'dist/.env.production').write_text('secret')
            with self.assertRaisesRegex(ValueError,'environment file'):
                module.package(root,root/'app.zip','b'*40)
    def test_rejects_external_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.make_root(root,'vite')
            (root/'dist/link.txt').symlink_to(root/'.env')
            with self.assertRaisesRegex(ValueError,'Symlink'):
                module.package(root,root/'app.zip','c'*40)

if __name__=='__main__':unittest.main()
