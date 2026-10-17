#!/usr/bin/env python3
"""Package only deployable output; never source .env files or repository metadata."""
import argparse, hashlib, json, os, re, shutil, tempfile, zipfile
from pathlib import Path

def package(root, output, revision):
    root, output = Path(root).resolve(), Path(output).resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('revision must be a full 40-character Git commit SHA')
    pkg = json.loads((root / 'package.json').read_text())
    deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
    stack = 'tanstack' if '@tanstack/react-start' in deps else 'vite'
    output_dir = '.output' if stack == 'tanstack' else 'dist'
    required = '.output/server/index.mjs' if stack == 'tanstack' else 'dist/index.html'
    if not (root / required).is_file():
        raise ValueError(f'Missing {required}; build first with the correct target')
    source = root / output_dir
    for folder, dirs, files in os.walk(source, followlinks=False):
        for name in dirs + files:
            p = Path(folder) / name
            if p.is_symlink():
                raise ValueError(f'Symlink in output {p.relative_to(root)}; produce a self-contained build without symlinks')
            if name == '.env' or name.startswith('.env.'):
                raise ValueError('An environment file was found in the build output')
    with tempfile.TemporaryDirectory(prefix='lovable-release-') as temp:
        stage = Path(temp)
        shutil.copytree(source, stage / output_dir)
        (stage / 'azure/runtime').mkdir(parents=True)
        shutil.copy2(root / 'azure/runtime/server.mjs', stage / 'azure/runtime/server.mjs')
        manifest = {'schemaVersion': 1, 'revision': revision, 'stack': stack}
        (stage / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for p in sorted(stage.rglob('*')):
                if p.is_file(): archive.write(p, p.relative_to(stage).as_posix())
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.sha256').write_text(f'{checksum}  {output.name}\n')
    print(json.dumps({**manifest, 'archive': str(output), 'sha256': checksum}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='.')
    parser.add_argument('--output', default='release/app.zip')
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    package(args.root, args.output, args.revision)
