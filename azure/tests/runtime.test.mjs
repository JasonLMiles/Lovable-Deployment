import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
const revision = 'a'.repeat(40);
async function unusedPort() {
  const s = net.createServer();
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}
async function fixture(t, stack) {
  const root = await mkdtemp(path.join(tmpdir(), 'lovable-host-test-'));
  await mkdir(path.join(root, 'azure/runtime'), { recursive: true });
  await cp(new URL('../runtime/server.mjs', import.meta.url), path.join(root, 'azure/runtime/server.mjs'));
  await writeFile(path.join(root, 'release.json'), JSON.stringify({ stack, revision }));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/index.html'), '<html><body>Example application</body></html>');
  await writeFile(path.join(root, 'dist/app.js'), 'console.log("app")');
  await writeFile(path.join(root, 'secret.txt'), 'must not be served');
  await symlink(path.join(root, 'secret.txt'), path.join(root, 'dist/leak.txt'));
  if (stack === 'tanstack') {
    await mkdir(path.join(root, '.output/server'), { recursive: true });
    await writeFile(path.join(root, '.output/server/index.mjs'), `
      import http from 'node:http';
      http.createServer((req,res)=>{
        if(req.url==='/unready'){res.writeHead(503);res.end();return;}
        if(req.url==='/echo'){res.setHeader('set-cookie',['one=1; HttpOnly','two=2; HttpOnly']);req.pipe(res);return;}
        if(req.url==='/stream'){res.write('first');setTimeout(()=>res.end('second'),30);return;}
        res.setHeader('content-type','text/html');res.end('<html>Server rendered</html>');
      }).listen(Number(process.env.PORT),process.env.HOST);
    `);
  }
  const port = await unusedPort();
  let internalPort = await unusedPort();
  while (internalPort === port) internalPort = await unusedPort();
  const child = spawn(process.execPath, ['azure/runtime/server.mjs'], { cwd: root,
    env: { ...process.env, PORT:String(port), APP_INTERNAL_PORT:String(internalPort),
      PUBLIC_APP_NAME:'Example', SECRET_DATABASE_PASSWORD:'do-not-expose', PUBLIC_UNRECOGNIZED_SECRET:'also-hidden' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit',resolve)), new Promise(resolve=>setTimeout(resolve,1500))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(root, { recursive:true, force:true });
  });
  const url = `http://127.0.0.1:${port}`;
  for(let i=0;i<70;i++) {
    try { const r=await fetch(url+'/healthz'); if(r.status===200) return {url, root, child, logs:()=>logs}; } catch {}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Fixture did not start: '+logs);
}
test('Vite host serves deep links and isolates public configuration', async t => {
  const {url, logs}=await fixture(t,'vite');
  assert.equal((await fetch(url+'/healthz').then(r=>r.json())).revision,revision);
  const deep = await fetch(url+'/reviews/42', {headers:{accept:'text/html'}});
  assert.equal(deep.status,200); assert.match(await deep.text(),/Example application/);
  for (const p of ['/missing.js','/api/missing','/.env','/%2e%2e%2fsecret.txt','/leak.txt']) {
    assert.equal((await fetch(url+p,{headers:{accept:'text/html'}})).status,404,p);
  }
  assert.equal((await fetch(url+'/reviews', {method:'POST'})).status,405);
  const config=await fetch(url+'/_deployment/runtime-config.json?token=secret-in-query');
  assert.equal(config.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(await config.json()).sort(),['apiBaseUrl','appName','environment','supabasePublishableKey','supabaseUrl'].sort());
  assert.doesNotMatch(logs(),/secret-in-query|do-not-expose|also-hidden/);
  const head=await fetch(url+'/app.js',{method:'HEAD'});
  assert.equal(head.status,200); assert.equal(await head.text(),'');
});
test('TanStack host forwards SSR, POST bodies, multiple cookies and streaming', async t => {
  const {url}=await fixture(t,'tanstack');
  assert.match(await fetch(url+'/').then(r=>r.text()),/Server rendered/);
  const response=await fetch(url+'/echo',{method:'POST',body:'request-body'});
  assert.equal(await response.text(),'request-body');
  assert.equal(response.headers.getSetCookie().length,2);
  assert.equal(await fetch(url+'/stream').then(r=>r.text()),'firstsecond');
  assert.equal((await fetch(url+'/_deployment/runtime-config.json').then(r=>r.json())).appName,'Example');
});
