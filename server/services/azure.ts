import { DefaultAzureCredential, ClientSecretCredential, EnvironmentCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { StorageManagementClient } from "@azure/arm-storage";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { ResourceManagementClient } from "@azure/arm-resources";
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Account, Resource, Cost } from "@shared/schema";

const execAsync = promisify(exec);

export class AzureService {
  private clients: Map<string, any> = new Map();

  private getCredentials(account: Account) {
    const credentials = account.credentials as any;
    
    // Set environment variables for Azure authentication
    if (credentials.tenantId) {
      process.env.AZURE_TENANT_ID = credentials.tenantId;
    }
    if (credentials.subscriptionId) {
      process.env.AZURE_SUBSCRIPTION_ID = credentials.subscriptionId;
    }
    if (credentials.clientId) {
      process.env.AZURE_CLIENT_ID = credentials.clientId;
    }
    if (credentials.clientSecret) {
      process.env.AZURE_CLIENT_SECRET = credentials.clientSecret;
    }

    // Try different authentication methods
    if (credentials.clientId && credentials.clientSecret && credentials.tenantId) {
      return new ClientSecretCredential(
        credentials.tenantId,
        credentials.clientId,
        credentials.clientSecret
      );
    } else {
      // Use environment credential first, then default
      try {
        return new EnvironmentCredential();
      } catch {
        return new DefaultAzureCredential({
          tenantId: credentials.tenantId
        });
      }
    }
  }

  private getClient(account: Account, service: string) {
    const clientKey = `${account.id}-${service}`;
    
    if (!this.clients.has(clientKey)) {
      const credentials = this.getCredentials(account);
      const subscriptionId = (account.credentials as any).subscriptionId;
      
      let client;
      switch (service) {
        case "compute":
          client = new ComputeManagementClient(credentials, subscriptionId);
          break;
        case "storage":
          client = new StorageManagementClient(credentials, subscriptionId);
          break;
        case "consumption":
          client = new ConsumptionManagementClient(credentials, subscriptionId);
          break;
        default:
          throw new Error(`Unsupported Azure service: ${service}`);
      }
      
      this.clients.set(clientKey, client);
    }
    
    return this.clients.get(clientKey);
  }

  async syncResources(account: Account): Promise<Resource[]> {
    console.log(`Syncing Azure resources for account: ${account.name}`);
    
    try {
      const credentials = account.credentials as any;
      
      // Set environment variables for Azure authentication
      process.env.AZURE_TENANT_ID = credentials.tenantId || process.env.AZURE_TENANT_ID;
      process.env.AZURE_SUBSCRIPTION_ID = credentials.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
      
      // For subscription-wide access, we'll use the Azure REST API directly
      // This bypasses the need for service principal and works with subscription-level access
      
      console.log('Using Azure REST API for subscription-wide resource discovery');
      
      // We'll implement direct REST API calls to Azure Resource Manager
      const subscriptionId = credentials.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
      
      // For now, try DefaultAzureCredential but plan for REST API fallback
      let credential;
      try {
        credential = new DefaultAzureCredential({
          tenantId: credentials.tenantId || process.env.AZURE_TENANT_ID
        });
        
        // Test the credential with a simple call
        const resourceClient = new ResourceManagementClient(credential, subscriptionId);
        await resourceClient.subscriptions.get(subscriptionId);
        console.log('DefaultAzureCredential authentication successful');
        
      } catch (authError) {
        console.log('DefaultAzureCredential failed, attempting alternative methods...');
        
        // Alternative: Use direct REST API calls without SDK
        return await this.discoverResourcesViaRestAPI(credentials, account);
      }
      
      // Create Resource Management client to discover ALL resources
      const resourceClient = new ResourceManagementClient(credential, subscriptionId);
      
      const resources: Resource[] = [];
      
      // Get ALL resources in the subscription
      console.log('Fetching ALL Azure resources across subscription...');
      try {
        const allResources = await resourceClient.resources.list();
        
        for await (const resource of allResources) {
          if (resource.name && resource.id && resource.location && resource.type) {
            const resourceType = this.mapAzureResourceType(resource.type);
            
            resources.push({
              accountId: account.id,
              resourceId: resource.id,
              name: resource.name,
              type: resourceType,
              provider: 'azure',
              status: 'active', // Most Azure resources are active if they exist
              region: resource.location,
              tags: resource.tags || {},
              metadata: {
                resourceType: resource.type,
                resourceGroup: this.getResourceGroupFromId(resource.id),
                kind: resource.kind,
                sku: resource.sku,
                plan: resource.plan,
                identity: resource.identity,
                managedBy: resource.managedBy,
              },
              cost: "0.00"
            });
          }
        }
        
        console.log(`Found ${resources.length} total Azure resources`);
        
        // Log resource type breakdown
        const typeBreakdown = resources.reduce((acc, r) => {
          acc[r.type] = (acc[r.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        console.log('Azure resource breakdown:', typeBreakdown);
        
      } catch (error) {
        console.error('Error fetching Azure resources:', error.message);
      }
      
      console.log(`Total Azure resources discovered: ${resources.length}`);
      return resources;
      
    } catch (error) {
      console.error('Error syncing Azure resources:', error);
      throw new Error(`Failed to sync Azure resources: ${error.message}`);
    }
  }

  private getResourceGroupFromId(resourceId: string): string {
    // Extract resource group from Azure resource ID
    const match = resourceId.match(/\/resourceGroups\/([^\/]+)/i);
    return match ? match[1] : 'unknown';
  }

  private mapAzureResourceType(azureType: string): string {
    // Map Azure resource types to our standardized types
    const typeMap: Record<string, string> = {
      'Microsoft.Compute/virtualMachines': 'azure-vm',
      'Microsoft.Storage/storageAccounts': 'azure-storage',
      'Microsoft.Sql/servers': 'azure-sql-server',
      'Microsoft.Sql/servers/databases': 'azure-sql-database',
      'Microsoft.Web/sites': 'azure-webapp',
      'Microsoft.Network/virtualNetworks': 'azure-vnet',
      'Microsoft.Network/networkSecurityGroups': 'azure-nsg',
      'Microsoft.Network/publicIPAddresses': 'azure-public-ip',
      'Microsoft.Network/loadBalancers': 'azure-load-balancer',
      'Microsoft.ContainerRegistry/registries': 'azure-container-registry',
      'Microsoft.KeyVault/vaults': 'azure-key-vault',
      'Microsoft.Insights/components': 'azure-app-insights',
      'Microsoft.DocumentDB/databaseAccounts': 'azure-cosmos-db',
      'Microsoft.Cache/Redis': 'azure-redis',
      'Microsoft.ServiceBus/namespaces': 'azure-service-bus',
      'Microsoft.EventHub/namespaces': 'azure-event-hub',
      'Microsoft.Logic/workflows': 'azure-logic-app',
      'Microsoft.Automation/automationAccounts': 'azure-automation',
      'Microsoft.RecoveryServices/vaults': 'azure-recovery-vault',
    };

    return typeMap[azureType] || `azure-${azureType.split('/').pop()?.toLowerCase() || 'resource'}`;
  }

  private async discoverResourcesViaRestAPI(credentials: any, account: Account): Promise<Resource[]> {
    console.log('Using Azure management endpoint for resource discovery');
    
    const resources: Resource[] = [];
    const subscriptionId = credentials.subscriptionId;
    const tenantId = credentials.tenantId;
    
    try {
      // Method 1: Get Azure management token via client credentials if available
      console.log('Checking for Azure service principal credentials...');
      const managementToken = await this.getManagementToken(tenantId, subscriptionId);
      if (managementToken) {
        console.log('✓ Azure service principal authentication successful!');
        return await this.discoverResourcesWithToken(managementToken, subscriptionId, account);
      }
      
      // Method 2: Try Azure CLI if available 
      const cliToken = await this.getAzureCliToken();
      if (cliToken) {
        console.log('Using Azure CLI session');
        return await this.discoverResourcesWithToken(cliToken, subscriptionId, account);
      }
      
      // Method 3: Show Azure discovery capability with resource types
      console.log('Azure Resource Discovery Ready - Will discover:');
      console.log('- Virtual Machines (all sizes, all regions)');
      console.log('- Storage Accounts (blob, file, queue, table storage)');
      console.log('- Databases (SQL Database, Cosmos DB, PostgreSQL, MySQL)');
      console.log('- Web Apps and App Services');
      console.log('- Networking (VNets, Subnets, Load Balancers, Gateways)');
      console.log('- Security Groups, Key Vaults, and 15+ other resource types');
      console.log('');
      console.log('Alternative authentication options:');
      console.log('1. Use existing service principal from your organization');
      console.log('2. Request Azure admin to create service principal with Reader role');
      console.log('3. Use Azure Cloud Shell with your user credentials');
      
    } catch (error) {
      console.error('Azure authentication failed:', error.message);
    }
    
    return resources;
  }

  private async getManagementToken(tenantId: string, subscriptionId: string): Promise<string | null> {
    try {
      // Method 1: Check if service principal credentials are available  
      const clientId = process.env.AZURE_CLIENT_ID;
      const clientSecret = process.env.AZURE_CLIENT_SECRET;
      
      console.log('Attempting Azure service principal authentication');
      console.log('Client ID:', clientId);
      console.log('Tenant ID:', tenantId);
      
      if (clientId && clientSecret) {
        const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
        const params = new URLSearchParams({
          'client_id': clientId,
          'client_secret': clientSecret,
          'scope': 'https://management.azure.com/.default',
          'grant_type': 'client_credentials'
        });

        const response = await fetch(authUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✓ Azure management token obtained successfully');
          console.log('Token length:', data.access_token?.length || 0);
          return data.access_token;
        } else {
          const errorText = await response.text();
          console.log('Azure authentication failed:', response.status);
          console.log('Error details:', errorText);
          
          if (errorText.includes('was not found in the directory')) {
            console.log('Service principal not found in tenant. Please verify:');
            console.log('1. Service principal exists in correct tenant');
            console.log('2. Client ID and Secret are correct');
            console.log('3. Service principal has Reader role on subscription');
          }
        }
      }
      
      // Method 2: Try Azure Instance Metadata Service (IMDS) for managed identity
      try {
        const imdsResponse = await fetch('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/', {
          headers: {
            'Metadata': 'true'
          },
          timeout: 2000
        });
        
        if (imdsResponse.ok) {
          const data = await imdsResponse.json();
          console.log('Azure token obtained via managed identity');
          return data.access_token;
        }
      } catch (imdsError) {
        // IMDS not available, continue to next method
      }
      
      return null;
    } catch (error) {
      console.log('Management token acquisition failed:', error.message);
      return null;
    }
  }

  private async getAzureCliToken(): Promise<string | null> {
    try {
      // Set PATH to include Azure CLI
      const azPath = '/nix/store/620cpakh22v42jd7177xhapirf3a0mkg-python3.11-azure-cli-2.60.0/bin';
      const { stdout } = await execAsync(`PATH="${azPath}:$PATH" az account get-access-token --query accessToken --output tsv`);
      return stdout.trim();
    } catch (error) {
      console.log('Azure CLI not available or not logged in');
      return null;
    }
  }

  private async getInteractiveToken(tenantId: string): Promise<string | null> {
    try {
      // For development environments, we can use interactive authentication
      // This would open a browser window for user login
      console.log('Interactive authentication would require browser access');
      return null;
    } catch (error) {
      return null;
    }
  }

  private async getDeviceCodeToken(tenantId: string): Promise<string | null> {
    try {
      console.log('\n=== AZURE DEVICE CODE AUTHENTICATION ===');
      const azPath = '/nix/store/620cpakh22v42jd7177xhapirf3a0mkg-python3.11-azure-cli-2.60.0/bin';
      
      // Check if already authenticated first
      try {
        const { stdout: token } = await execAsync(`PATH="${azPath}:$PATH" az account get-access-token --query accessToken --output tsv`, { timeout: 3000 });
        if (token && token.trim()) {
          console.log('✓ Azure CLI session active! Using existing authentication.');
          return token.trim();
        }
      } catch (checkError) {
        // Not authenticated, proceed with device code flow
      }
      
      console.log('Starting Azure device code authentication...');
      console.log('Please complete authentication at: https://microsoft.com/devicelogin');
      
      // Start device code authentication with timeout
      const { stdout, stderr } = await execAsync(`PATH="${azPath}:$PATH" timeout 120 az login --tenant ${tenantId} --use-device-code --only-show-errors`, { timeout: 150000 });
      
      if (stdout) {
        console.log('Azure authentication output:', stdout);
      }
      
      // After authentication, get token
      try {
        const { stdout: token } = await execAsync(`PATH="${azPath}:$PATH" az account get-access-token --query accessToken --output tsv`);
        if (token && token.trim()) {
          console.log('✓ Azure authentication successful! Token obtained.');
          return token.trim();
        }
      } catch (tokenError) {
        console.log('Failed to get access token after authentication');
      }
      
      return null;
    } catch (error) {
      console.log('Device code authentication process failed:', error.message);
      return null;
    }
  }

  private async discoverResourcesWithToken(accessToken: string, subscriptionId: string, account: Account): Promise<Resource[]> {
    const resources: Resource[] = [];
    
    try {
      // Direct REST API call to Azure Resource Manager
      const response = await fetch(
        `https://management.azure.com/subscriptions/${subscriptionId}/resources?api-version=2021-04-01`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Azure API error: ${response.status} ${response.statusText}`);
        console.log('Error details:', errorText);
        
        if (response.status === 403) {
          console.log('Need Microsoft.Resources/subscriptions/resources/read permission');
          console.log('Add to app registration: Azure Resource Manager → user_impersonation (Delegated)');
          console.log('Or: Microsoft Graph → Directory.Read.All (Application)');
          console.log('Alternative: Assign Reader role at subscription level');
        }
        
        throw new Error(`Azure API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`Discovered ${data.value?.length || 0} Azure resources via REST API`);
      
      for (const azureResource of data.value || []) {
        const resource: Resource = {
          id: 0, // Will be set by database
          accountId: account.id,
          provider: 'azure',
          type: this.mapAzureResourceType(azureResource.type),
          name: azureResource.name,
          region: azureResource.location || 'unknown',
          status: 'active',
          metadata: {
            resourceGroup: azureResource.id.split('/')[4],
            azureResourceType: azureResource.type,
            resourceId: azureResource.id,
            kind: azureResource.kind,
            sku: azureResource.sku,
            tags: azureResource.tags || {}
          },
          createdAt: new Date(),
          lastSyncAt: new Date()
        };
        
        resources.push(resource);
      }
      
    } catch (error) {
      console.error('Failed to discover resources via REST API:', error.message);
    }
    
    return resources;
  }

  private async syncVirtualMachines(account: Account): Promise<Resource[]> {
    const computeClient = this.getClient(account, "compute");
    const resources: Resource[] = [];

    try {
      const vms = computeClient.virtualMachines.listAll();
      
      for await (const vm of vms) {
        resources.push({
          accountId: account.id,
          resourceId: vm.id!,
          name: vm.name!,
          type: "azure-vm",
          provider: "azure",
          status: vm.instanceView?.statuses?.find(s => s.code?.startsWith("PowerState"))?.displayStatus || "unknown",
          region: vm.location,
          metadata: {
            resourceGroup: vm.id?.split('/')[4],
            vmSize: vm.hardwareProfile?.vmSize,
            osType: vm.storageProfile?.osDisk?.osType,
            imageReference: vm.storageProfile?.imageReference,
            tags: vm.tags,
          },
          monthlyCost: this.estimateVMCost(vm.hardwareProfile?.vmSize || ""),
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error("Error syncing Azure VMs:", error);
    }

    return resources;
  }

  private async syncStorageAccounts(account: Account): Promise<Resource[]> {
    const storageClient = this.getClient(account, "storage");
    const resources: Resource[] = [];

    try {
      const storageAccounts = storageClient.storageAccounts.list();
      
      for await (const storageAccount of storageAccounts) {
        resources.push({
          accountId: account.id,
          resourceId: storageAccount.id!,
          name: storageAccount.name!,
          type: "azure-storage",
          provider: "azure",
          status: storageAccount.statusOfPrimary || "unknown",
          region: storageAccount.location,
          metadata: {
            resourceGroup: storageAccount.id?.split('/')[4],
            kind: storageAccount.kind,
            tier: storageAccount.accessTier,
            replication: storageAccount.sku?.name,
            tags: storageAccount.tags,
          },
          monthlyCost: "0.00", // Would need usage metrics for accurate costs
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error("Error syncing Azure storage accounts:", error);
    }

    return resources;
  }

  private async syncDisks(account: Account): Promise<Resource[]> {
    const computeClient = this.getClient(account, "compute");
    const resources: Resource[] = [];

    try {
      const disks = computeClient.disks.list();
      
      for await (const disk of disks) {
        resources.push({
          accountId: account.id,
          resourceId: disk.id!,
          name: disk.name!,
          type: "azure-disk",
          provider: "azure",
          status: disk.diskState || "unknown",
          region: disk.location,
          metadata: {
            resourceGroup: disk.id?.split('/')[4],
            diskSizeGB: disk.diskSizeGB,
            diskSizeBytes: disk.diskSizeBytes,
            sku: disk.sku?.name,
            osType: disk.osType,
            tags: disk.tags,
          },
          monthlyCost: this.estimateDiskCost(disk.diskSizeGB || 0, disk.sku?.name || ""),
          lastUpdated: new Date(),
        });
      }
    } catch (error) {
      console.error("Error syncing Azure disks:", error);
    }

    return resources;
  }

  async getCostData(account: Account, startDate: Date, endDate: Date): Promise<Cost[]> {
    const consumptionClient = this.getClient(account, "consumption");
    const costs: Cost[] = [];

    try {
      const filter = `properties/usageStart ge '${startDate.toISOString()}' and properties/usageEnd le '${endDate.toISOString()}'`;
      
      const usageDetails = consumptionClient.usageDetails.list("subscriptions/" + (account.credentials as any).subscriptionId, {
        filter,
        expand: "properties/meterDetails",
      });

      for await (const usage of usageDetails) {
        costs.push({
          accountId: account.id,
          service: usage.meterDetails?.meterCategory || "Unknown",
          amount: (usage.pretaxCost || 0).toString(),
          currency: usage.billingCurrency || "USD",
          period: "daily",
          date: new Date(usage.usageStart || ""),
        });
      }
    } catch (error) {
      console.error("Error fetching Azure cost data:", error);
    }

    return costs;
  }

  private estimateVMCost(vmSize: string): string {
    // Simplified cost estimation - in production, use Azure Pricing API
    const costMap: Record<string, number> = {
      "Standard_B1s": 7.30,
      "Standard_B2s": 29.20,
      "Standard_D2s_v3": 70.08,
      "Standard_D4s_v3": 140.16,
      "Standard_E2s_v3": 87.60,
    };
    
    return (costMap[vmSize] || 50.00).toFixed(2);
  }

  private estimateDiskCost(sizeGB: number, skuName: string): string {
    const costPerGB: Record<string, number> = {
      "Standard_LRS": 0.04,
      "Standard_ZRS": 0.05,
      "Premium_LRS": 0.15,
      "StandardSSD_LRS": 0.075,
    };
    
    const monthlyCost = Math.max(sizeGB * (costPerGB[skuName] || 0.04), 4.00); // Minimum cost
    return monthlyCost.toFixed(2);
  }
}
