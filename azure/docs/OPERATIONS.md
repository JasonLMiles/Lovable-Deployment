# Operate the release path

## Release responsibilities

The application team owns application tests, backend access, business authorization, schema compatibility, and acceptance. The platform team owns the infrastructure, runtime adapter, pipeline, dependency updates, networking, and production release policy. The service owner sets availability objectives and alert thresholds.

Keep the production approval gate focused on the staged commit and recorded acceptance. A successful `/healthz` call confirms the runtime can answer and that the intended revision is present. It does not prove that an invoice was authorized, a record saved correctly, or a model integration met its policy.

## Roll back with the previous release still in staging

After a successful slot swap, the former production release is in staging. Freeze new releases during an incident. If a release is awaiting approval, cancel that workflow deliberately before starting rollback; the shared concurrency group otherwise keeps the candidate stable and blocks another operation.

Read `/healthz` on each slot and record both commit SHAs. Confirm the older application is compatible with the current schema, records and queued jobs. Run Azure rollback on `main` with those two SHAs and the compatibility checkbox. The protected production environment still requires approval. The workflow refuses to swap if staging or the identifiable production revision has changed.

The workflow checks current production identity even when `/healthz` returns 503. If the process is completely unavailable, it cannot establish that identity. Use the recovery procedure below instead of weakening the check. There is no automatic database rollback.

## Recover from an archived artifact

If staging was overwritten or the previous application cannot be identified, select the retained release artifact from its known successful workflow run. Download the artifact, validate `app.sha256`, and inspect `release.json` inside `app.zip`. Use the established deployment identity or an authorized operator to deploy that ZIP to staging, then run the smoke script with that commit SHA. Validate backend compatibility and business behavior before an approved slot swap.

```bash
sha256sum --check app.sha256
unzip -p app.zip release.json
az webapp deploy --resource-group YOUR-RESOURCE-GROUP \
  --name YOUR-APP --slot staging --src-path app.zip --type zip --restart true
node azure/scripts/smoke.mjs \
  https://YOUR-APP-staging.azurewebsites.net PREVIOUS-FULL-COMMIT-SHA
az webapp deployment slot swap --resource-group YOUR-RESOURCE-GROUP \
  --name YOUR-APP --slot staging --target-slot production
```

The example is an operator recovery procedure, subject to your normal access and release controls. It does not recompile the old commit with today's dependencies. Retain artifacts longer than 30 days if your recovery policy requires it.

## Diagnose common failures

| Symptom | First check |
| --- | --- |
| Preflight rejects the repo | npm lockfile and real build/lint/typecheck/test scripts |
| TanStack package has no server | Current Lovable Nitro integration, installed Nitro, `NITRO_PRESET=node-server` |
| Login loop after moving the URL | Correct single-tenant registration, both callback URLs, valid Key Vault login secret |
| Key Vault reference stays unresolved | Runtime identity RBAC, vault network path, secret existence and expiry |
| Azure login cannot exchange OIDC token | Exact repository case, environment name, client ID and federated subject |
| ZIP deployment gets 403 | Staging identity slot publishing permission, SCM network access, private DNS resolution; use Azure CLI diagnostic output without exposing tokens |
| Health returns 503 for SSR | Node startup logs and an internal `APP_HEALTH_PATH` that returns 2xx; redirects are not readiness |
| App loads but points at an old backend | Remaining browser build-time settings or a service worker caching runtime config |
| Client-side route refresh returns 404 | Correct Vite output package and root URL deployment |
| Business API still accepts unauthorized calls | Its independent token validation, authorization and data policies |
| Post-swap business failure | Backend compatibility, current secrets, acceptance gaps; use the rollback decision above |

## Observe the service

In Log Analytics, start with console records for the app and staging slot. The deployment host emits JSON with event, status, duration and revision. Application-generated logs share the stream. Adjust the resource predicate for the selected app.

```kusto
AppServiceConsoleLogs
| where TimeGenerated > ago(30m)
| where _ResourceId contains "/sites/YOUR-APP"
| project TimeGenerated, Level, ResultDescription, _ResourceId
| order by TimeGenerated desc
```

Create Azure Monitor alerts for sustained failed health checks and abnormal 5xx volume, with an action group owned by the service team. The template enables collection; it deliberately does not invent an on-call address or workload-specific threshold. Instrument server dependencies and browser errors with your approved Application Insights/OpenTelemetry setup where deeper tracing is needed.

The starter uses one App Service instance by default. Set `instanceCount` and the plan size for the workload. Two or more healthy instances enable useful health-based rerouting. Staging shares plan capacity and can affect production under heavy tests; use separate apps/plans for load testing.

## Configuration and schema changes

Keep infrastructure configuration in the Bicep parameter inputs. App settings in the template are sticky to their slots, and the paired release slot receives the same service configuration as production. Avoid untracked portal edits that a later deployment overwrites. Secret rotation uses Key Vault; validate its propagation and login behavior in a maintenance process.

Use backward-compatible database migrations where both old and new app versions may run during deployment. Apply and record those migrations using the backend owner's pipeline. Destructive schema changes require an application-specific deployment plan; a slot swap alone cannot make them reversible.

## Boundaries of this starter

This is one region, one App Service app and a release slot. It does not implement cross-region disaster recovery, backups, backend migrations, WebSocket forwarding, a custom domain, certificate automation, WAF rules, application-specific CSP, or complete business authorization. Add these when the actual application requires them. Azure DevOps can use the same Bicep and artifact/runtime contract, but an Azure Pipelines implementation is not included.
