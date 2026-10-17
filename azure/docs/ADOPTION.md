# Adopt the deployment template

The example application is a delivery-review tool. Its name is illustrative; replace the names and IDs below with your own values. The main route uses GitHub, Azure CLI, Bicep, and App Service. You need no Docker installation.

## 1 Prepare access and the repository

You need a Lovable project connected to an organization-owned GitHub repository; repository administration rights; a supported GitHub plan for environment reviewers on that repository; and Azure access to deploy resources and assign roles. Azure Contributor alone cannot create the role assignments in the template. An Entra application administrator should provision the login application and approve user access. A Key Vault administrator must provision the secret and grant the deployment operator any needed secret-management permissions.

Download or clone [JasonLMiles/Lovable-Deployment](https://github.com/JasonLMiles/Lovable-Deployment). The [source ZIP](https://github.com/JasonLMiles/Lovable-Deployment/archive/refs/heads/main.zip) contains the same starter files as the repository's `main` branch.

Connect Lovable using its project Git settings and choose a development branch. Copy the package's `azure/` directory into the application repository root. Copy the three `workflow-templates/*.yml` files into the application's `.github/workflows/` directory, creating it if necessary. Merge with existing workflow files deliberately; do not overwrite unrelated automation. Merge `.gitignore.example` into the application's `.gitignore`, and retain the starter's MIT copyright and permission notice with the copied code. Keep all application code in place. Branch `main` must require pull requests and the `Azure validation / validate` check. Require platform-owner review for `azure/` and `.github/workflows/` through your actual CODEOWNERS configuration.

The starter repository's own `.github/workflows/starter-validation.yml` checks the shared components. The three files in `workflow-templates/` become the consuming application's CI/CD workflows when copied to the destination above.

## 2 Prepare a reproducible application build

Use Node.js 22 and commit `package-lock.json`. If the project uses only a Bun lockfile, deliberately standardize it on npm: generate and review the npm lockfile, test locally, then commit the change. The template does not silently select a different package manager.

The required `package.json` scripts are `build`, `lint`, `typecheck`, and `test:ci`. `azure/examples/package-scripts.json` shows common commands; use the app's actual TypeScript projects and test runner. In a Vite project, `tsc --noEmit` against an empty root project may check nothing, so target the appropriate project configuration. Add a useful application test for at least one real business rule. Do not add a no-op script just to satisfy preflight.

For a TanStack app, confirm `@tanstack/react-start` and `nitro` are present. Use the current Lovable build configuration that supports Nitro outside Lovable. Preserve its other options. The template sets `NITRO_PRESET=node-server` for builds and requires `.output/server/index.mjs`. A Vite app must produce `dist/index.html`.

## 3 Integrate runtime configuration

Copy `azure/examples/runtime-config.ts` into `src/config/runtime-config.ts`. Load the configuration before creating browser API or Supabase clients. Replace relevant browser `import.meta.env.VITE_*` references with this configuration object. Do not alter server-only secret handling to use the browser endpoint. TanStack server functions read their own environment values directly.

For Lovable previews, retain a development-only configuration branch such as `if (import.meta.env.DEV)`, or run the deployment host during local release testing. Keep preview credentials restricted to nonproduction services. Confirm that the production build contains no environment-specific backend address accidentally embedded in browser code. The build job intentionally receives no backend credentials or public build-time values.

Copyable Lovable implementation prompt:

> Prepare this application's browser configuration for Azure deployment. Inspect the existing frontend initialization and Supabase or API clients. Add a typed configuration loader that fetches /_deployment/runtime-config.json with credentials same-origin and cache no-store before creating those clients. Its exact properties are appName, environment, apiBaseUrl, supabaseUrl, and supabasePublishableKey. Preserve the current nonproduction preview behavior behind import.meta.env.DEV. Keep server secrets in server environment variables. Preserve the current authentication model and data access rules. Remove production dependencies on browser build-time backend URLs. Add tests for configuration load failure and the existing business rules. Show the changed files and identify any backend behavior that needs a separate migration. Do not modify azure/ or .github/workflows/.

The prompt guides code changes. Repository review rules enforce ownership. Validate preview behavior and the release build after applying it.

## 4 Run local checks

Run from the application repository root:

```bash
node azure/scripts/preflight.mjs
npm ci
npm run lint
npm run typecheck
npm run test:ci
npm audit --audit-level=high
node --test azure/tests/runtime.test.mjs
python3 -m unittest discover -s azure/tests -p 'test_*.py'
NITRO_PRESET=node-server npm run build
python3 azure/scripts/package.py --revision "$(git rev-parse HEAD)"
az bicep build --file azure/infra/main.bicep
```

The packager writes `release/app.zip` and `release/app.sha256`. Source files, root `.env` files, and Git metadata are not packaged. A secret embedded by your bundler is still a secret in the artifact; the packaging boundary cannot undo that.

To exercise the packaged output, extract it into a temporary directory and run `PORT=8080 node azure/runtime/server.mjs` there. In a second terminal, invoke the smoke script from the repository with `http://localhost:8080`, the same commit SHA, and `local`. Open a deep link, refresh it, and exercise the app's normal workflow. This local mode has no Entra access protection.

## 5 Provision login and its Key Vault secret

Create a single-tenant Entra web app registration. For the chosen globally unique App Service name, add these web redirect URIs:

```text
https://YOUR-APP.azurewebsites.net/.auth/login/aad/callback
https://YOUR-APP-staging.azurewebsites.net/.auth/login/aad/callback
```

Under the associated enterprise application, require user assignment and assign the intended users or groups. Record the application client ID. Create a client secret through your approved process and store it in an RBAC-enabled Key Vault **in the resource group you will deploy to**. Record its versionless secret URI. Track its expiry and rotate it before expiration. Do not commit the secret itself or put it in a GitHub variable.

The template grants its runtime managed identity Key Vault Secrets User on that vault. Use a vault dedicated to this application's environment to keep the permission scope appropriate. The CI identities do not need direct Key Vault secret access. This is a web login secret; the GitHub-to-Azure connection uses OIDC without a stored deployment secret.

## 6 Review and deploy infrastructure

Copy `azure/examples/parameters.example.json` to `azure/parameters.production.json` and replace every placeholder. The resource group and vault must already exist. Keep secret values out of that file; pass only Key Vault reference strings. Set `publicConfig` and `serverSettings` for the app's chosen backend. Use the same backend for production and the release validation slot.

```bash
az login
az account set --subscription YOUR-SUBSCRIPTION-ID
az deployment group what-if \
  --resource-group YOUR-RESOURCE-GROUP \
  --template-file azure/infra/main.bicep \
  --parameters @azure/parameters.production.json
az deployment group create \
  --name lovable-platform \
  --resource-group YOUR-RESOURCE-GROUP \
  --template-file azure/infra/main.bicep \
  --parameters @azure/parameters.production.json
```

Expect an App Service plan, application, staging slot, three managed identities, federated trusts, RBAC, authentication settings, and Log Analytics. The app has no release code yet and can be unhealthy until the first deployment. The default S1 plan has one instance; choose capacity and at least two instances where availability requires healthy-instance rerouting. Plan capacity is shared by the two slots.

For a private app, also provide `integrationSubnetId`, `privateEndpointSubnetId`, and `privateDnsZoneId`. The integration subnet must be delegated to `Microsoft.Web/serverFarms`; the private endpoint subnet must be different. Create/link the `privatelink.azurewebsites.net` private DNS zone to the runner/client networks. This module does not create those networks or private endpoints for your databases and vault.

## 7 Protect GitHub environments and configure variables

In repository Settings, create environments named exactly `staging` and `production`. For both, choose selected deployment branches and allow only branch `main`. For production, configure required reviewers and prevent self-review. If your GitHub plan does not provide these controls for the repository, resolve that platform prerequisite before enabling production releases.

Run:

```bash
gh auth login
bash azure/scripts/configure-github.sh \
  YOUR-ORG/YOUR-REPOSITORY YOUR-RESOURCE-GROUP lovable-platform
```

The script checks the required reviewers and branch policies and writes the Azure client IDs, tenant, subscription, resource group, app name, and URLs to environment variables. No password is created. If using private endpoints, set repository variable `AZURE_RUNNER_LABEL` to a Linux runner label with network/DNS access to both app and SCM endpoints. Install Azure CLI, Node, Python and the runner prerequisites there. Do not run untrusted PR jobs on that privileged runner; validation uses a hosted runner.

## 8 Release and accept the first app

Merge a reviewed change to `main`, or run Azure release manually on `main`. The build must pass before the staging identity obtains an Azure token. The pipeline checks the archive checksum, deploys to staging, checks the commit reported by `/healthz`, and confirms anonymous requests to the app/config endpoint are redirected to sign-in.

Before approving the production environment, sign into staging as an assigned user. Confirm an unassigned user is refused. Run one permitted business transaction and one forbidden operation against designated test records. Confirm your backend enforces the rules even if someone calls its API directly. Approve the release; the workflow rechecks the staged commit, swaps it, and checks production.

Record the run ID, commit, business checks, and any database migration version. Perform one rollback rehearsal in the disposable environment before adopting the pattern for production.
