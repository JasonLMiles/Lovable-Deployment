// Copy into src/config/runtime-config.ts. Call before creating browser API clients.
export type RuntimeConfig = {
  appName: string;
  environment: string;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
};
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/_deployment/runtime-config.json', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Application configuration is unavailable; sign in and reload');
  }
  return response.json() as Promise<RuntimeConfig>;
}
// Browser example, after await loadRuntimeConfig():
// createClient(config.supabaseUrl, config.supabasePublishableKey)
// TanStack server code reads server-only environment variables directly.
