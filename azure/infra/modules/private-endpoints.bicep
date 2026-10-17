param appId string
param appName string
param location string
param subnetId string
@minLength(1)
param privateDnsZoneId string
var connections = [{ suffix: 'production', groupId: 'sites' }, { suffix: 'staging', groupId: 'sites-staging' }]
resource endpoints 'Microsoft.Network/privateEndpoints@2023-11-01' = [for connection in connections: {
  name: '${appName}-${connection.suffix}-pe'
  location: location
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [{
      name: '${appName}-${connection.suffix}'
      properties: { privateLinkServiceId: appId, groupIds: [connection.groupId] }
    }]
  }
}]
resource zones 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = [for (connection, index) in connections: {
  parent: endpoints[index]
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'app-service', properties: { privateDnsZoneId: privateDnsZoneId } }] }
}]
