targetScope = 'resourceGroup'

@minLength(2)
@maxLength(40)
param appName string
param location string = resourceGroup().location
@description('Exact case-sensitive OWNER/REPO used by GitHub OIDC subjects.')
param githubRepository string
@description('Existing single-tenant Entra web application client ID.')
param authClientId string
@description('Versionless URI of its login secret in the existing Key Vault.')
param authSecretUri string
@description('An RBAC-enabled Key Vault in this resource group. Provision before this deployment.')
param existingVaultName string
@allowed(['S1', 'S2', 'S3', 'P1v3', 'P2v3', 'P3v3'])
param skuName string = 'S1'
@minValue(1)
param instanceCount int = 1
@description('Browser-visible values only; the runtime exposes a fixed allowlist.')
param publicConfig object = {}
@secure()
@description('Server app settings. Use Key Vault references for secrets, not literal secret values.')
param serverSettings object = {}
@description('Optional VNet integration subnet resource ID. Must be delegated to Microsoft.Web/serverFarms.')
param integrationSubnetId string = ''
@description('Private endpoint subnet ID for inbound traffic; distinct from the integration subnet.')
param privateEndpointSubnetId string = ''
@description('Existing privatelink.azurewebsites.net private DNS zone ID, linked to the runner and client VNets.')
param privateDnsZoneId string = ''
var isPrivate = !empty(privateEndpointSubnetId)
var tags = { application: appName, managedBy: 'Bicep', template: 'lovable-azure-1.0.0' }

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: existingVaultName }
resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-runtime'
  location: location
  tags: tags
}
resource stageIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-ci-stage'
  location: location
  tags: tags
}
resource productionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-ci-prod'
  location: location
  tags: tags
}
resource stageTrust 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: stageIdentity
  name: 'github-staging'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:staging'
    audiences: ['api://AzureADTokenExchange']
  }
}
resource productionTrust 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: productionIdentity
  name: 'github-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:production'
    audiences: ['api://AzureADTokenExchange']
  }
}
resource vaultRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, runtimeIdentity.id, 'key-vault-secrets-user')
  scope: vault
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: skuName, tier: startsWith(skuName, 'P') ? 'PremiumV3' : 'Standard', capacity: instanceCount }
  properties: { reserved: true }
}
var settings = union(publicConfig, serverSettings, {
  NODE_ENV: 'production'
  WEBSITE_RUN_FROM_PACKAGE: '1'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  ENABLE_ORYX_BUILD: 'false'
  WEBSITE_HEALTHCHECK_MAXPINGFAILURES: '3'
  WEBSITE_SWAP_WARMUP_PING_PATH: '/healthz'
  WEBSITE_SWAP_WARMUP_PING_STATUSES: '200'
  MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: '@Microsoft.KeyVault(SecretUri=${authSecretUri})'
  WEBSITE_AUTH_AAD_ALLOWED_TENANTS: tenant().tenantId
})
var siteConfig = {
  linuxFxVersion: 'NODE|22-lts'
  appCommandLine: 'node azure/runtime/server.mjs'
  alwaysOn: true
  ftpsState: 'Disabled'
  minTlsVersion: '1.2'
  scmMinTlsVersion: '1.2'
  healthCheckPath: '/healthz'
  http20Enabled: true
  vnetRouteAllEnabled: !empty(integrationSubnetId)
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${runtimeIdentity.id}': {} } }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: isPrivate ? 'Disabled' : 'Enabled'
    keyVaultReferenceIdentity: runtimeIdentity.id
    virtualNetworkSubnetId: empty(integrationSubnetId) ? null : integrationSubnetId
    siteConfig: siteConfig
  }
}
resource stage 'Microsoft.Web/sites/slots@2023-12-01' = {
  parent: app
  name: 'staging'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${runtimeIdentity.id}': {} } }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: isPrivate ? 'Disabled' : 'Enabled'
    keyVaultReferenceIdentity: runtimeIdentity.id
    virtualNetworkSubnetId: empty(integrationSubnetId) ? null : integrationSubnetId
    siteConfig: siteConfig
  }
}
resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'appsettings'
  properties: settings
  dependsOn: [vaultRead]
}
resource stageSettings 'Microsoft.Web/sites/slots/config@2023-12-01' = {
  parent: stage
  name: 'appsettings'
  properties: settings
  dependsOn: [vaultRead]
}
resource sticky 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'slotConfigNames'
  properties: { appSettingNames: [for item in items(settings): item.key] }
}
var auth = {
  platform: { enabled: true, runtimeVersion: '~1' }
  globalValidation: { requireAuthentication: true, unauthenticatedClientAction: 'RedirectToLoginPage'
    redirectToProvider: 'azureactivedirectory', excludedPaths: ['/healthz'] }
  httpSettings: { requireHttps: true }
  identityProviders: {
    azureActiveDirectory: {
      enabled: true
      registration: {
        clientId: authClientId
        openIdIssuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
        clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
      }
      validation: { allowedAudiences: [authClientId, 'api://${authClientId}'] }
    }
  }
  login: { tokenStore: { enabled: false } }
}
resource appAuth 'Microsoft.Web/sites/config@2022-09-01' = { parent: app, name: 'authsettingsV2', properties: auth }
resource stageAuth 'Microsoft.Web/sites/slots/config@2022-09-01' = { parent: stage, name: 'authsettingsV2', properties: auth }
resource appFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = { parent: app, name: 'ftp', properties: { allow: false } }
resource appScm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = { parent: app, name: 'scm', properties: { allow: false } }
resource stageFtp 'Microsoft.Web/sites/slots/basicPublishingCredentialsPolicies@2023-12-01' = { parent: stage, name: 'ftp', properties: { allow: false } }
resource stageScm 'Microsoft.Web/sites/slots/basicPublishingCredentialsPolicies@2023-12-01' = { parent: stage, name: 'scm', properties: { allow: false } }

resource stageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(stage.id, stageIdentity.id, 'website-contributor')
  scope: stage
  properties: {
    principalId: stageIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
  }
}
resource stageRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(app.id, stageIdentity.id, 'reader')
  scope: app
  properties: {
    principalId: stageIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  }
}
resource productionAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(app.id, productionIdentity.id, 'website-contributor')
  scope: app
  properties: {
    principalId: productionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${appName}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}
resource appDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'application-logs'
  scope: app
  properties: {
    workspaceId: logs.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [{ category: 'AppServiceConsoleLogs', enabled: true }, { category: 'AppServicePlatformLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
resource stageDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'application-logs'
  scope: stage
  properties: {
    workspaceId: logs.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [{ category: 'AppServiceConsoleLogs', enabled: true }, { category: 'AppServicePlatformLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
module privateNetwork 'modules/private-endpoints.bicep' = if (isPrivate) {
  name: 'private-network'
  params: { appId: app.id, appName: appName, location: location
    subnetId: privateEndpointSubnetId, privateDnsZoneId: privateDnsZoneId }
  dependsOn: [stage]
}

output appNameOut string = app.name
output productionUrl string = 'https://${app.properties.defaultHostName}'
output stagingUrl string = 'https://${stage.properties.defaultHostName}'
output stageClientId string = stageIdentity.properties.clientId
output productionClientId string = productionIdentity.properties.clientId
output tenantId string = tenant().tenantId
output subscriptionId string = subscription().subscriptionId
output resourceGroupName string = resourceGroup().name
output logWorkspaceId string = logs.id
