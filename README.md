# Lovable Deployment: Azure App Service starter

Version 1.0.0 | Published October 17, 2026 | [MIT license](LICENSE)

This package adds an Azure deployment path to a Lovable application synchronized with GitHub. It contains an overlay for your existing application repository, not a new application. It supports older React/Vite single-page apps and newer TanStack Start apps built with Nitro's `node-server` preset.

The baseline uses Linux App Service, Node.js 22, an npm lockfile, a staging slot, Microsoft Entra sign-in, Key Vault references, GitHub OIDC, and a compiled ZIP release. Production promotion swaps the tested staging release. No container registry is required.

## Download the code

**[Download the latest source ZIP](https://github.com/JasonLMiles/Lovable-Deployment/archive/refs/heads/main.zip)** and extract it. You can also select **Code → Download ZIP** on the [repository page](https://github.com/JasonLMiles/Lovable-Deployment).

To keep Git history and receive later updates, clone the repository:

```bash
git clone https://github.com/JasonLMiles/Lovable-Deployment.git
cd Lovable-Deployment
```

The download contains the deployment starter and documentation. Your Lovable application's source stays in its own GitHub repository. A ZIP download includes the `workflow-templates/` folder, so you do not need to copy hidden folders from the download.

## Quick start

1. Connect your Lovable application to GitHub and create a branch for adopting the starter.
2. Copy this repository's `azure/` directory into the application's repository root.
3. Copy the three files in `workflow-templates/` into the application's `.github/workflows/` directory. Create that directory if needed, and review any existing files before merging. These workflows belong in the application repository.
4. Merge the entries in [.gitignore.example](.gitignore.example) into the application's `.gitignore`. Integrate the browser configuration loader and supply real build, lint, type-check, and test scripts as described in the [adoption guide](azure/docs/ADOPTION.md).
5. Complete the guide's local checks, Entra registration, Key Vault secret reference, Bicep deployment, and GitHub environment setup. Azure resources are provisioned when you run the deployment commands and incur charges under your subscription.
6. Merge a reviewed application change to `main`, verify staging, and approve the production promotion. Rehearse rollback with a disposable environment before production adoption.

### Prerequisites

- A Lovable application connected to GitHub, with repository administration access and an npm lockfile.
- Node.js 22, npm, Python 3, Azure CLI with Bicep, and GitHub CLI for setup.
- An Azure subscription, an existing resource group and application-specific Key Vault, and permission to create the required resources and role assignments.
- An Entra administrator for the login application and user assignment, plus a GitHub plan that supports the required environment protections.

The [step-by-step adoption guide](azure/docs/ADOPTION.md) provides the commands and explains the exact access requirements.

## What is included

| File or directory | Purpose |
| --- | --- |
| `azure/infra/main.bicep` | App Service plan, app, staging slot, identity, authentication, deployment permissions, Key Vault access, and logging |
| `azure/infra/modules/private-endpoints.bicep` | Optional inbound private endpoints and DNS zone groups for production and staging |
| `workflow-templates/azure-ci.yml` | Application pull request checks; copy into the application's `.github/workflows/` |
| `workflow-templates/azure-release.yml` | Build once, deploy staging, check, await production approval, swap, check again |
| `workflow-templates/azure-rollback.yml` | Guarded swap back to the previous release |
| `.github/workflows/starter-validation.yml` | Component tests and Bicep compilation for this starter repository |
| `azure/runtime/server.mjs` | Static host or HTTP adapter around the TanStack server, with health and public configuration endpoints |
| `azure/scripts/package.py` | Assemble a minimal deployable archive and SHA-256 checksum |
| `azure/scripts/configure-github.sh` | Verify environment protection and set the deployment variables from Bicep outputs |
| `azure/examples/` | Parameters, browser configuration loader, and package script examples |
| `azure/tests/` | Runtime and package boundary tests |
| `azure/docs/` | Adoption, operations, backend migration, and verification notes |

## Guides and local checks

| Guide | Use it for |
| --- | --- |
| [Adoption](azure/docs/ADOPTION.md) | App changes, identity, infrastructure, release setup, and first deployment |
| [Operations](azure/docs/OPERATIONS.md) | Promotion, rollback, recovery, monitoring, and troubleshooting |
| [Backends](azure/docs/BACKENDS.md) | Keeping the current backend or planning a separate migration |
| [Verification](azure/docs/VERIFICATION.md) | Recorded component checks and tenant-specific acceptance work |
| [Sources](azure/docs/SOURCES.md) | Platform documentation supporting the design |

From the root of this starter repository, run:

```bash
node --test azure/tests/runtime.test.mjs
python3 -m unittest discover -s azure/tests -p 'test_*.py'
az bicep build --file azure/infra/main.bicep
```

These checks exercise the supplied components. Application build commands such as `npm ci` run in the consuming Lovable repository, after the starter has been integrated. The starter repository's CI checks the components and compiles Bicep; it does not deploy an application. The three Azure release workflows become active when copied into the consuming application's `.github/workflows/` directory.

The [verification record](azure/docs/VERIFICATION.md) distinguishes completed component checks from sign-in, networking, application behavior, and rollback checks that require your tenant and application.

## The deployment model

Lovable edits a development branch. A pull request brings the change into `main`. CI validates that change and produces one ZIP, identified by its Git commit. A staging deployment identity can deploy to the staging slot. A separate production identity can perform the promotion after a protected GitHub environment has been approved. The workflow rechecks the staged commit immediately before swapping.

The whole release workflow and the rollback workflow share one concurrency group. A pending approval therefore holds staging steady. GitHub may replace an older pending run with a newer pending run; it does not cancel the active release. This template deliberately has one active staging candidate at a time.

The staging slot is a **production release validation slot**, configured against the same production services. It is not a separate development or UAT environment. Provision separate resource groups/apps for dev and UAT. Schema changes and data migrations are application-specific and stay outside this generic release workflow.

## Runtime configuration

The browser loads `/_deployment/runtime-config.json`. The runtime returns only these settings:

| Azure setting | JSON property | Intended content |
| --- | --- | --- |
| `PUBLIC_APP_NAME` | `appName` | Display name |
| `PUBLIC_ENVIRONMENT` | `environment` | Environment label |
| `PUBLIC_API_BASE_URL` | `apiBaseUrl` | A public URL or same-origin `/api` |
| `PUBLIC_SUPABASE_URL` | `supabaseUrl` | Supabase project URL if retained |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `supabasePublishableKey` | A browser publishable key, never a service-role key |

The response uses `Cache-Control: no-store`. Extra environment variables, even ones beginning with `PUBLIC_`, are not exposed. The browser loader is an example to integrate into the app; copying the template does not automatically rewrite existing `import.meta.env` references. Do not cache this endpoint in a service worker. Set server-only values separately, preferably as Key Vault references.

The Vite host implements HTML route fallback, GET/HEAD, MIME types, and a filesystem boundary. It does not send the SPA shell for unknown API or asset requests. The TanStack adapter forwards HTTP requests and response streams to the production server on loopback. It preserves request bodies and multiple cookies. WebSocket upgrades return 501; applications requiring WebSockets need a suitable adapter before adoption. Deployment at a URL subpath also requires application-specific routing changes.

## Access and monitoring

App Service Easy Auth protects the site and runtime configuration endpoint. `/healthz` is explicitly exempt so deployment checks can verify availability and the expected commit. It exposes only status and commit identity. For TanStack, it checks an internal application route, configurable with `APP_HEALTH_PATH`; the default `/` must return 2xx. For Vite, it confirms the SPA entry point exists. Extend application readiness and user-flow testing to cover your dependencies.

Microsoft Entra user access, business roles, and backend permissions are separate. Configure assignment requirements in the enterprise application; enforce operations and record access in server code or backend policies. The deployment host is **not an authorization implementation**. Local execution has no Easy Auth boundary.

The template routes console and platform logs plus metrics to a 30-day Log Analytics workspace. Host request logs omit paths, query strings, claims, and bodies. Your application remains responsible for its own logging behavior. Distributed tracing and browser telemetry require application instrumentation. See the operations guide for alerts and queries.

For private deployment, provide the existing integration subnet, private endpoint subnet, and private DNS zone. The template creates separate production and staging endpoints, including SCM records through DNS zone groups, and disables public ingress. Use network-connected clients and deployment runners. Dependency endpoints such as Key Vault, databases, and package registries need their own network configuration.

## Ongoing ownership

Treat `azure/` and the workflows as maintained platform code. Require review for changes to these files, pin action versions to approved commit SHAs under your organization's dependency policy, and keep Node and dependencies supported. Major-version action references are used here for readability. Test updates in a separate environment before promotion.

The package does not move databases, replace Supabase, or host the Lovable editor inside Azure. `azure/docs/BACKENDS.md` explains those separate decisions.

## License

Copyright (c) 2026 Jason L Miles. This project is distributed under the [MIT License](LICENSE). You may use, modify, and redistribute the code, including commercially, subject to the license terms. Retain the copyright and permission notice when distributing copies or substantial portions of the software.
