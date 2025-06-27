import { MCPServer, MCPTool, MCPResource, MCPPrompt } from './base';
import { AWSService } from '../services/aws';
import { AzureService } from '../services/azure';
import { SnowflakeService } from '../services/snowflake';
import { storage } from '../storage';
import type { Account } from '@shared/schema';

export class CloudSyncMCPServer extends MCPServer {
  private awsService = new AWSService();
  private azureService = new AzureService();
  private snowflakeService = new SnowflakeService();

  constructor() {
    super('cloud-sync', '1.0.0');
  }

  initializeTools(): void {
    this.registerTool({
      name: 'sync_account_resources',
      description: 'Synchronize resources from a cloud account',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'number', description: 'Account ID to sync' },
          force: { type: 'boolean', description: 'Force full resync', default: false }
        },
        required: ['accountId']
      },
      handler: async (params) => this.syncAccountResources(params.accountId, params.force)
    });

    this.registerTool({
      name: 'sync_account_costs',
      description: 'Synchronize cost data from a cloud account',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'number', description: 'Account ID to sync costs for' },
          startDate: { type: 'string', description: 'Start date (ISO string)' },
          endDate: { type: 'string', description: 'End date (ISO string)' }
        },
        required: ['accountId']
      },
      handler: async (params) => this.syncAccountCosts(
        params.accountId, 
        params.startDate ? new Date(params.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        params.endDate ? new Date(params.endDate) : new Date()
      )
    });

    this.registerTool({
      name: 'get_sync_status',
      description: 'Get synchronization status for all accounts',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'number', description: 'Optional account ID filter' }
        }
      },
      handler: async (params) => this.getSyncStatus(params.accountId)
    });

    this.registerTool({
      name: 'validate_account_credentials',
      description: 'Test account credentials and connectivity',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'number', description: 'Account ID to validate' }
        },
        required: ['accountId']
      },
      handler: async (params) => this.validateAccountCredentials(params.accountId)
    });
  }

  initializeResources(): void {
    this.registerResource({
      uri: 'sync://accounts',
      name: 'Cloud Accounts',
      description: 'List of configured cloud accounts',
      mimeType: 'application/json'
    });

    this.registerResource({
      uri: 'sync://resources',
      name: 'Cloud Resources',
      description: 'Synchronized cloud resources across all accounts',
      mimeType: 'application/json'
    });

    this.registerResource({
      uri: 'sync://costs',
      name: 'Cost Data',
      description: 'Cost and billing data from cloud providers',
      mimeType: 'application/json'
    });
  }

  initializePrompts(): void {
    this.registerPrompt({
      name: 'sync_recommendations',
      description: 'Generate recommendations for cloud resource synchronization',
      arguments: [
        { name: 'account_type', description: 'Type of cloud account (aws, azure, snowflake)', required: true },
        { name: 'resource_count', description: 'Number of resources to sync', required: false }
      ]
    });
  }

  private async syncAccountResources(accountId: number, force: boolean = false): Promise<any> {
    const accounts = await storage.getAccounts();
    console.log(`Syncing account ${accountId}, available accounts:`, accounts.map(a => ({id: a.id, name: a.name, provider: a.provider})));
    const account = accounts.find(acc => acc.id === accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found. Available IDs: ${accounts.map(a => a.id).join(', ')}`);
    }

    const lastSync = account.lastSyncAt;
    const now = new Date();
    const hoursSinceLastSync = lastSync ? (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60) : Infinity;

    if (!force && hoursSinceLastSync < 1) {
      return {
        status: 'skipped',
        message: 'Account synced recently, use force=true to override',
        lastSyncAt: lastSync
      };
    }

    let resources: any[] = [];
    let syncErrors: string[] = [];

    try {
      switch (account.provider) {
        case 'aws':
          resources = await this.awsService.syncResources(account);
          break;
        case 'azure':
          resources = await this.azureService.syncResources(account);
          break;
        case 'snowflake':
          resources = await this.snowflakeService.syncResources(account);
          break;
        default:
          throw new Error(`Unsupported provider: ${account.provider}`);
      }

      // Clear existing resources for this account
      await storage.deleteResourcesByAccount(accountId);

      // Insert new resources
      console.log(`Storing ${resources.length} resources for account ${accountId}:`, resources.slice(0, 3).map(r => ({type: r.type, name: r.name, region: r.region})));
      
      // Process resources in batches to avoid overwhelming the database
      const batchSize = 50;
      let stored = 0;
      
      for (let i = 0; i < resources.length; i += batchSize) {
        const batch = resources.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.length} resources`);
        
        for (const resource of batch) {
          try {
            const resourceData = {
              accountId: resource.accountId,
              resourceId: resource.resourceId,
              name: resource.name,
              type: resource.type,
              provider: account.provider,
              status: resource.status,
              region: resource.region,
              tags: resource.tags || {},
              metadata: resource.metadata || {},
              monthlyCost: resource.cost || "0.00"
            };
            
            await storage.createResource(resourceData);
            stored++;
            
            if (stored % 25 === 0) {
              console.log(`Stored ${stored}/${resources.length} resources`);
            }
          } catch (error) {
            console.error(`Failed to store resource ${resource.resourceId}:`, error.message);
          }
        }
      }
      
      console.log(`Successfully stored ${stored}/${resources.length} resources`);
      
      // Update account sync timestamp
      await storage.updateAccount(accountId, {});

      return {
        status: 'success',
        resourceCount: resources.length,
        syncedAt: now,
        provider: account.provider,
        errors: syncErrors
      };
    } catch (error) {
      syncErrors.push(error instanceof Error ? error.message : String(error));
      return {
        status: 'error',
        resourceCount: 0,
        syncedAt: now,
        provider: account.provider,
        errors: syncErrors
      };
    }
  }

  private async syncAccountCosts(accountId: number, startDate: Date, endDate: Date): Promise<any> {
    const account = await storage.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    let costs: any[] = [];
    let syncErrors: string[] = [];

    try {
      switch (account.provider) {
        case 'aws':
          costs = await this.awsService.getCostData(account, startDate, endDate);
          break;
        case 'azure':
          costs = await this.azureService.getCostData(account, startDate, endDate);
          break;
        case 'snowflake':
          costs = await this.snowflakeService.getCostData(account, startDate, endDate);
          break;
        default:
          throw new Error(`Unsupported provider: ${account.provider}`);
      }

      // Insert cost data
      for (const cost of costs) {
        await storage.createCost(cost);
      }

      return {
        status: 'success',
        costRecordCount: costs.length,
        syncedAt: new Date(),
        provider: account.provider,
        dateRange: { startDate, endDate },
        errors: syncErrors
      };
    } catch (error) {
      syncErrors.push(error instanceof Error ? error.message : String(error));
      return {
        status: 'error',
        costRecordCount: 0,
        syncedAt: new Date(),
        provider: account.provider,
        dateRange: { startDate, endDate },
        errors: syncErrors
      };
    }
  }

  private async getSyncStatus(accountId?: number): Promise<any> {
    const accounts = accountId 
      ? [await storage.getAccount(accountId)].filter(Boolean)
      : await storage.getAccounts();

    const status = await Promise.all(
      accounts.map(async (account) => {
        const resources = await storage.getResourcesByAccount(account!.id);
        const costs = await storage.getCostsByAccount(account!.id);
        
        return {
          accountId: account!.id,
          accountName: account!.name,
          provider: account!.provider,
          status: account!.status,
          lastSyncAt: account!.lastSyncAt,
          resourceCount: resources.length,
          costRecordCount: costs.length,
          syncNeeded: !account!.lastSyncAt || 
            (new Date().getTime() - account!.lastSyncAt.getTime()) > (60 * 60 * 1000) // 1 hour
        };
      })
    );

    return {
      totalAccounts: accounts.length,
      accountsNeedingSync: status.filter(s => s.syncNeeded).length,
      accounts: status
    };
  }

  private async validateAccountCredentials(accountId: number): Promise<any> {
    const accounts = await storage.getAccounts();
    console.log(`Looking for account ${accountId} in accounts:`, accounts.map(a => ({id: a.id, name: a.name, provider: a.provider})));
    const account = accounts.find(acc => acc.id === accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found. Available IDs: ${accounts.map(a => a.id).join(', ')}`);
    }

    try {
      let validationResult: any;

      switch (account.provider) {
        case 'aws':
          // Try to list a small set of resources to validate credentials
          validationResult = await this.awsService.syncResources(account);
          break;
        case 'azure':
          validationResult = await this.azureService.syncResources(account);
          break;
        case 'snowflake':
          validationResult = await this.snowflakeService.syncResources(account);
          break;
        default:
          throw new Error(`Unsupported provider: ${account.provider}`);
      }

      return {
        status: 'valid',
        provider: account.provider,
        accountId: account.id,
        accountName: account.name,
        testedAt: new Date(),
        message: 'Credentials are valid and account is accessible'
      };
    } catch (error) {
      return {
        status: 'invalid',
        provider: account.provider,
        accountId: account.id,
        accountName: account.name,
        testedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to validate account credentials'
      };
    }
  }
}