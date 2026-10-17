#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo 'Usage: configure-github.sh OWNER/REPO RESOURCE_GROUP BICEP_DEPLOYMENT_NAME' >&2; exit 2
fi
repo="$1"; resource_group="$2"; deployment="$3"
command -v gh >/dev/null; command -v az >/dev/null; command -v python3 >/dev/null
# First create and protect environments in GitHub. Do not silently create an unprotected production target.
config=$(gh api "repos/$repo/environments/production")
printf '%s' "$config" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert any(r.get("type")=="required_reviewers" and r.get("reviewers") for r in d.get("protection_rules",[])), "production needs required reviewers"
'
for environment in staging production; do
  gh api "repos/$repo/environments/$environment" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert (d.get("deployment_branch_policy") or {}).get("custom_branch_policies"), "Select custom deployment branches and allow only main"
'
  gh api "repos/$repo/environments/$environment/deployment-branch-policies" | python3 -c '
import json,sys
policies=json.load(sys.stdin).get("branch_policies",[])
assert len(policies)==1 and policies[0]["name"]=="main" and policies[0].get("type","branch")=="branch", "Only the main branch may deploy to this environment"
'
done
outputs=$(az deployment group show --resource-group "$resource_group" --name "$deployment" --query properties.outputs -o json)
field() { printf '%s' "$outputs" | python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]]["value"])' "$1"; }
for environment in staging production; do
  gh variable set AZURE_TENANT_ID --repo "$repo" --env "$environment" --body "$(field tenantId)"
  gh variable set AZURE_SUBSCRIPTION_ID --repo "$repo" --env "$environment" --body "$(field subscriptionId)"
  gh variable set AZURE_RESOURCE_GROUP --repo "$repo" --env "$environment" --body "$(field resourceGroupName)"
  gh variable set AZURE_WEBAPP_NAME --repo "$repo" --env "$environment" --body "$(field appNameOut)"
  gh variable set AZURE_STAGING_URL --repo "$repo" --env "$environment" --body "$(field stagingUrl)"
  gh variable set AZURE_PRODUCTION_URL --repo "$repo" --env "$environment" --body "$(field productionUrl)"
  if [ "$environment" = staging ]; then identity=$(field stageClientId); else identity=$(field productionClientId); fi
  gh variable set AZURE_CLIENT_ID --repo "$repo" --env "$environment" --body "$identity"
done
echo 'Environment variables configured. Verify both environment branch policies allow only main.'
