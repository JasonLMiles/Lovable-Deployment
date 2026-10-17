# Choose the backend scope

Moving the application web host to App Service can preserve Lovable Cloud or managed Supabase. Update the application's environment settings, allowed browser origins where applicable, login redirects, and webhook callbacks. Browser requests to a retained Supabase endpoint still leave Azure. The backend continues to own its access rules and operational duties.

For an Azure-contained runtime, inventory each dependency before replacing it. Do not infer that a PostgreSQL restore reproduces a backend platform.

| Current capability | An Azure implementation to evaluate | Application work |
| --- | --- | --- |
| PostgreSQL data | Azure Database for PostgreSQL | Schema/data migration, extensions, credentials, policies, connection behavior |
| Supabase authentication | Entra identity plus application session/authorization design | Map user identity and claims; replace client calls and adapt data rules |
| Supabase database API and RLS | Application API on App Service/Functions, with explicit authorization | Replace direct browser SDK access or operate a compatible Supabase stack |
| File storage | Azure Blob Storage behind an authorized API or scoped access | Migrate objects, rewrite paths and permissions, set retention |
| Edge Functions | App Service server functions or Azure Functions | Port runtime-specific code, dependencies, credentials and deployment |
| Realtime subscriptions | Appropriate realtime service or application design | Adapt connection and event semantics; template has no WebSocket adapter |
| Schedules and background work | Functions, Logic Apps or another owned job service | Recreate schedules, retries and idempotency; avoid duplicate execution |
| Lovable AI gateway | Azure-hosted model endpoint or another approved provider | Change SDK/API contract, credentials, policy and cost tracking |
| App connectors | Direct service integration or governed API | Reauthorize, replace gateway calls, handle token refresh and scopes |

These are architectural mappings, not automatic conversions or a promise of feature equivalence. A compatible Supabase stack is another migration route if preserving its APIs matters more than changing individual services.

Define the desired production boundary explicitly: application host only; application plus private Azure APIs; or all runtime data and services in Azure. The Lovable editor remains a separate managed development service. Keep its preview/test environment and production access deliberately configured.

Test the full backend path after migration: sign-in, access denial, record creation/update, file access, function execution, schedules, and AI/integration responses. Reconcile migrated counts and checksums where applicable. Release the web artifact only after the target backend meets the application's contract.
