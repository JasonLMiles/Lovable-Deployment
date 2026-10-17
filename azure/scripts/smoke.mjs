// Deployment checks, not a substitute for authenticated business-flow tests.
const [baseUrl, expectedRevision, authMode = 'required'] = process.argv.slice(2);
if (!/^https?:\/\//.test(baseUrl || '') || !/^[a-f0-9]{40}$/.test(expectedRevision || '')) {
  throw new Error('Usage: node azure/scripts/smoke.mjs URL FULL_COMMIT_SHA [required|local]');
}
let ready = false;
for (let attempt = 0; attempt < 36; attempt++) {
  try {
    const response = await fetch(new URL('/healthz', baseUrl), { redirect:'manual', signal:AbortSignal.timeout(8000) });
    const body = await response.json();
    ready = response.status === 200 && body.status === 'ok' && body.revision === expectedRevision;
  } catch { /* Restart or cold start. Retry with a bounded budget. */ }
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!ready) throw new Error('The intended release did not become healthy before the deadline');
if (authMode === 'required') {
  for (const pathname of ['/', '/_deployment/runtime-config.json']) {
    const response = await fetch(new URL(pathname, baseUrl), { redirect:'manual', signal:AbortSignal.timeout(10000) });
    const location = new URL(response.headers.get('location') || '/', baseUrl);
    if (response.status !== 302 || location.origin !== new URL(baseUrl).origin || !location.pathname.startsWith('/.auth/login/')) {
      throw new Error(`Expected the App Service authentication redirect on ${pathname}`);
    }
  }
}
console.log(authMode === 'required'
  ? 'Expected revision is healthy; configured authentication boundary responds correctly.'
  : 'Expected revision is healthy; local mode skipped the Azure authentication check.');
