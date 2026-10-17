# Verification record

Prepared October 12, 2026. This is a reusable deployment starter, not evidence of a deployment to your Azure tenant.

## Checks executed

- Bicep CLI 0.48.1 compiled the main template and private-endpoint module into ARM JSON. The final compile completed without warnings or errors.
- Two Node test groups passed on both Node 24 and Node 22. They exercised actual local HTTP processes for Vite and a representative TanStack server-output fixture.
- Runtime cases included client route refresh, missing assets, missing API routes, encoded traversal, an external symlink, disallowed methods, HEAD requests, the public-config allowlist, no-store behavior, omission of secrets/query values from host logs, server responses, POST bodies, multiple Set-Cookie headers, and streaming responses.
- Three Python unittest groups passed. They verified both archive layouts and commit manifests, exclusion of source/root environment files, checksum output, rejection of build-output environment files, and rejection of symlinks.
- All three GitHub Actions files parsed as YAML. The configuration shell script passed Bash syntax validation, and the JavaScript utilities passed Node syntax checks.

## Repository publication checks — October 17, 2026

- The two Node runtime tests passed again on Node 24.19.0; the three Python packaging tests passed again.
- The starter validation workflow and three application workflow templates parsed as YAML. JavaScript syntax checks and Bash syntax validation passed.
- The Azure workflow templates now live in `workflow-templates/`. The starter repository has its own component-validation workflow, including Node 22 tests and Bicep compilation. The original Bicep compile result above remains the locally recorded infrastructure check; a new GitHub Actions run reports its own result.
- Repository publication adds the README, download and adoption instructions, and the MIT license. It does not provision Azure resources or change an adopting application's repository settings.

## Checks requiring the adopter's environment

- Build and test the actual Lovable repository under Node 22 with its committed npm lockfile and current Nitro configuration where applicable. The local SSR fixture is not a generated Lovable application or a Nitro integration test.
- Run Azure `what-if` and deployment validation in the selected subscription/region. Compilation does not validate capacity, resource policies, permissions, SKU availability, DNS, or service-side behavior.
- Verify the staging identity can publish through Azure CLI with the scoped slot permissions and that production promotion succeeds with the separate identity. The package has not executed Azure OIDC exchange, deployment, or swapping.
- Test Entra sign-in, required user assignment, the Key Vault secret reference, and backend authorization with real tenant identities.
- If private access is enabled, verify private app/SCM DNS and connectivity from the deployment runner, user network, and relevant backend paths.
- Confirm runtime configuration is integrated into the real browser clients and preview behavior still works. Test an authenticated business flow and a denied operation.
- Rehearse promotion, post-deployment verification, artifact recovery, and data-compatible rollback in a disposable environment.

No Azure resources, app registrations, production data, or GitHub repository settings were changed while creating this package. No Azure integration result, load test, or application security certification is claimed.
