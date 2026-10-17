import { readFile, access } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await access('package-lock.json');
for (const script of ['build', 'lint', 'typecheck', 'test:ci']) {
  if (!pkg.scripts?.[script]) throw new Error(`Add an actual ${script} script to package.json before enabling CI`);
}
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
if (deps['@tanstack/react-start'] && !deps.nitro) throw new Error('TanStack deployment requires Nitro');
console.log('Package manager and required build/check scripts are configured.');
