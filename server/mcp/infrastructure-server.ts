import { MCPServer, MCPTool, MCPResource } from "./base";
import { storage } from "../storage";

export class InfrastructureMCPServer extends MCPServer {
  constructor() {
    super("infrastructure", "1.0.0");
  }

  initializeTools(): void {
    // Account management tools
    this.registerTool({
      name: "get_accounts",
      description: "Get all cloud accounts with their providers and credentials status",
      inputSchema: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            description: "Filter by provider (aws, azure, snowflake)",
            enum: ["aws", "azure", "snowflake"]
          }
        }
      },
      handler: async (params) => {
        const accounts = params.provider 
          ? await storage.getAccountsByProvider(params.provider)
          : await storage.getAccounts();
        return {
          total: accounts.length,
          accounts: accounts.map(acc => ({
            id: acc.id,
            name: acc.name,
            provider: acc.provider,
            region: acc.region,
            status: acc.credentials ? "configured" : "missing_credentials",
            createdAt: acc.createdAt
          }))
        };
      }
    });

    // Resource discovery tools
    this.registerTool({
      name: "get_resources",
      description: "Get infrastructure resources with filtering options",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: {
            type: "array",
            items: { type: "number" },
            description: "Filter by specific account IDs"
          },
          type: {
            type: "string",
            description: "Filter by resource type (ec2-instance, ebs-volume, s3-bucket, etc.)"
          },
          region: {
            type: "string",
            description: "Filter by AWS region"
          },
          status: {
            type: "string",
            description: "Filter by resource status"
          },
          limit: {
            type: "number",
            description: "Limit number of results (default 100)",
            default: 100
          }
        }
      },
      handler: async (params) => {
        let resources = await storage.getResources(params.accountIds);
        
        // Apply filters
        if (params.type) {
          resources = resources.filter(r => r.type === params.type);
        }
        if (params.region) {
          resources = resources.filter(r => r.region === params.region);
        }
        if (params.status) {
          resources = resources.filter(r => r.status === params.status);
        }
        
        // Apply limit
        const limited = resources.slice(0, params.limit || 100);
        
        return {
          total: resources.length,
          returned: limited.length,
          resources: limited.map(r => ({
            id: r.id,
            accountId: r.accountId,
            resourceId: r.resourceId,
            name: r.name,
            type: r.type,
            region: r.region,
            status: r.status,
            monthlyCost: r.monthlyCost,
            metadata: r.metadata,
            discoveredAt: r.discoveredAt
          }))
        };
      }
    });

    // Resource statistics
    this.registerTool({
      name: "get_resource_stats",
      description: "Get resource statistics and breakdowns",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: {
            type: "array",
            items: { type: "number" },
            description: "Filter by specific account IDs"
          },
          groupBy: {
            type: "string",
            enum: ["type", "region", "account", "status"],
            description: "Group statistics by field",
            default: "type"
          }
        }
      },
      handler: async (params) => {
        const resources = await storage.getResources(params.accountIds);
        const groupBy = params.groupBy || "type";
        
        const groups = new Map<string, any>();
        
        resources.forEach(resource => {
          const key = resource[groupBy as keyof typeof resource]?.toString() || "unknown";
          if (!groups.has(key)) {
            groups.set(key, {
              count: 0,
              totalMonthlyCost: 0,
              resources: []
            });
          }
          
          const group = groups.get(key)!;
          group.count++;
          group.totalMonthlyCost += parseFloat(resource.monthlyCost || "0");
          group.resources.push({
            id: resource.resourceId,
            name: resource.name,
            type: resource.type,
            region: resource.region,
            cost: resource.monthlyCost
          });
        });
        
        return {
          totalResources: resources.length,
          groupedBy: groupBy,
          groups: Object.fromEntries(
            Array.from(groups.entries()).map(([key, value]) => [
              key,
              {
                count: value.count,
                totalMonthlyCost: value.totalMonthlyCost.toFixed(2),
                sampleResources: value.resources.slice(0, 5)
              }
            ])
          )
        };
      }
    });

    // Unattached resources finder
    this.registerTool({
      name: "find_unattached_resources",
      description: "Find unattached or unused resources that may be costing money",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: {
            type: "array",
            items: { type: "number" },
            description: "Filter by specific account IDs"
          },
          resourceType: {
            type: "string",
            description: "Focus on specific resource type (ebs-volume, elastic-ip, etc.)"
          }
        }
      },
      handler: async (params) => {
        const resources = await storage.getResources(params.accountIds);
        
        let unattachedResources = resources.filter(resource => {
          // EBS volumes - use simple status field (more reliable than metadata parsing)
          if (resource.type === "ebs-volume") {
            return resource.status === "available";
          }
          
          // Elastic IPs - check metadata for association
          if (resource.type === "elastic-ip") {
            try {
              const metadata = typeof resource.metadata === 'string' ? JSON.parse(resource.metadata) : resource.metadata;
              return !metadata?.AssociationId;
            } catch {
              return false;
            }
          }
          
          // Load balancers with no targets
          if (resource.type === "load-balancer") {
            try {
              const metadata = typeof resource.metadata === 'string' ? JSON.parse(resource.metadata) : resource.metadata;
              return metadata?.TargetGroups?.length === 0;
            } catch {
              return false;
            }
          }
          
          return false;
        });
        
        if (params.resourceType) {
          unattachedResources = unattachedResources.filter(r => r.type === params.resourceType);
        }
        
        const totalWaste = unattachedResources.reduce((sum, r) => sum + parseFloat(r.monthlyCost || "0"), 0);
        
        return {
          found: unattachedResources.length,
          totalMonthlyCost: totalWaste.toFixed(2),
          resources: unattachedResources.map(r => ({
            resourceId: r.resourceId,
            name: r.name,
            type: r.type,
            region: r.region,
            monthlyCost: r.monthlyCost,
            attachmentInfo: r.metadata?.Attachments || r.metadata?.AssociationId || "None",
            state: r.metadata?.State || r.status
          }))
        };
      }
    });

    // Cost analysis tools
    this.registerTool({
      name: "get_costs_by_region",
      description: "Get cost data grouped by AWS region with service breakdown",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: {
            type: "array",
            items: { type: "number" },
            description: "Filter by specific account IDs"
          },
          startDate: {
            type: "string",
            description: "Start date for cost data (ISO format)"
          },
          endDate: {
            type: "string", 
            description: "End date for cost data (ISO format)"
          }
        }
      }
    });

    this.registerTool({
      name: "get_costs",
      description: "Get cost data with filtering and aggregation options",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: {
            type: "array",
            items: { type: "number" },
            description: "Filter by specific account IDs"
          },
          service: {
            type: "string",
            description: "Filter by AWS service name"
          },
          startDate: {
            type: "string",
            format: "date",
            description: "Start date for cost data (YYYY-MM-DD)"
          },
          endDate: {
            type: "string",
            format: "date",
            description: "End date for cost data (YYYY-MM-DD)"
          },
          groupBy: {
            type: "string",
            enum: ["service", "date", "account"],
            description: "Group costs by field",
            default: "service"
          }
        }
      },
      handler: async (params) => {
        let startDate, endDate;
        if (params.startDate) startDate = new Date(params.startDate);
        if (params.endDate) endDate = new Date(params.endDate);
        
        const costs = await storage.getCosts(params.accountIds, startDate, endDate);
        
        let filteredCosts = costs;
        if (params.service) {
          filteredCosts = costs.filter(c => c.service.toLowerCase().includes(params.service.toLowerCase()));
        }
        
        // Group costs
        const groups = new Map<string, { amount: number, records: number }>();
        
        filteredCosts.forEach(cost => {
          let key: string;
          switch (params.groupBy) {
            case "service":
              key = cost.service;
              break;
            case "date":
              key = cost.date.toISOString().split('T')[0];
              break;
            case "account":
              key = cost.accountId.toString();
              break;
            default:
              key = cost.service;
          }
          
          if (!groups.has(key)) {
            groups.set(key, { amount: 0, records: 0 });
          }
          
          const group = groups.get(key)!;
          group.amount += parseFloat(cost.amount);
          group.records++;
        });
        
        const totalAmount = filteredCosts.reduce((sum, c) => sum + parseFloat(c.amount), 0);
        
        return {
          totalRecords: filteredCosts.length,
          totalAmount: totalAmount.toFixed(2),
          currency: "USD",
          groupedBy: params.groupBy || "service",
          groups: Object.fromEntries(
            Array.from(groups.entries())
              .map(([key, value]) => [key, {
                amount: value.amount.toFixed(2),
                records: value.records,
                percentage: ((value.amount / totalAmount) * 100).toFixed(1)
              }])
              .sort((a, b) => parseFloat(b[1].amount) - parseFloat(a[1].amount))
          )
        };
      }
    });

    // Alert management
    this.registerTool({
      name: "get_alerts",
      description: "Get system alerts and notifications",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: {
            type: "array",
            items: { type: "number" },
            description: "Filter by specific account IDs"
          },
          unreadOnly: {
            type: "boolean",
            description: "Only return unread alerts",
            default: false
          }
        }
      },
      handler: async (params) => {
        const alerts = params.unreadOnly 
          ? await storage.getUnreadAlerts(params.accountIds)
          : await storage.getAlerts(params.accountIds);
        
        return {
          total: alerts.length,
          alerts: alerts.map(alert => ({
            id: alert.id,
            accountId: alert.accountId,
            type: alert.type,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            isRead: alert.isRead,
            createdAt: alert.createdAt
          }))
        };
      }
    });
  }

  initializeResources(): void {
    this.registerResource({
      uri: "infrastructure://accounts",
      name: "Cloud Accounts",
      description: "All configured cloud provider accounts",
      mimeType: "application/json"
    });

    this.registerResource({
      uri: "infrastructure://resources",
      name: "Infrastructure Resources",
      description: "All discovered cloud resources across accounts",
      mimeType: "application/json"
    });

    this.registerResource({
      uri: "infrastructure://costs",
      name: "Cost Data",
      description: "Historical and current cost data from cloud providers",
      mimeType: "application/json"
    });

    this.registerResource({
      uri: "infrastructure://alerts",
      name: "System Alerts",
      description: "Infrastructure alerts and notifications",
      mimeType: "application/json"
    });
  }

  initializePrompts(): void {
    this.registerPrompt({
      name: "analyze_infrastructure",
      description: "Analyze infrastructure for cost optimization opportunities",
      arguments: [
        {
          name: "account_filter",
          description: "Specific account to analyze (e.g., 'p310', 'production', 'azure')",
          required: false
        },
        {
          name: "focus_area",
          description: "Area to focus on (costs, security, performance, optimization)",
          required: false
        }
      ]
    });

    this.registerPrompt({
      name: "cost_breakdown",
      description: "Provide detailed cost breakdown and trends",
      arguments: [
        {
          name: "time_period",
          description: "Time period to analyze (current_month, last_month, last_quarter)",
          required: false
        },
        {
          name: "account_filter",
          description: "Specific account to analyze",
          required: false
        }
      ]
    });

    this.registerPrompt({
      name: "resource_inventory",
      description: "Generate comprehensive resource inventory report",
      arguments: [
        {
          name: "resource_type",
          description: "Specific resource type to focus on",
          required: false
        },
        {
          name: "account_filter",
          description: "Specific account to analyze",
          required: false
        }
      ]
    });
  }

  async executeTool(name: string, params: any): Promise<any> {
    if (name === 'get_costs_by_region') {
      const regionalCosts = await storage.getCosts(params.accountIds, params.startDate, params.endDate);
      
      // Group by region using resource data
      const resources = await storage.getResources(params.accountIds);
      const resourceRegionMap = new Map();
      resources.forEach(resource => {
        resourceRegionMap.set(resource.resourceId, resource.region);
      });
      
      const regionalGrouped = regionalCosts.reduce((acc, cost) => {
        // Try to get region from resource mapping, fallback to extracting from resourceId/usageType
        let region = 'Unknown';
        if (cost.resourceId && resourceRegionMap.has(cost.resourceId)) {
          region = resourceRegionMap.get(cost.resourceId);
        } else if (cost.usageType && cost.usageType.includes('Region')) {
          const match = cost.usageType.match(/([a-z]{2}-[a-z]+-\d+)/);
          if (match) region = match[1];
        } else if (cost.resourceId && cost.resourceId.includes('arn:aws:')) {
          const match = cost.resourceId.match(/arn:aws:[^:]+:([^:]+):/);
          if (match) region = match[1];
        }
        
        if (!acc[region]) {
          acc[region] = { amount: 0, records: 0, percentage: 0, services: {} };
        }
        acc[region].amount += parseFloat(cost.amount);
        acc[region].records += 1;
        
        // Track services within region
        const service = cost.service || 'Unknown';
        if (!acc[region].services[service]) {
          acc[region].services[service] = 0;
        }
        acc[region].services[service] += parseFloat(cost.amount);
        
        return acc;
      }, {} as Record<string, { amount: number; records: number; percentage: number; services: Record<string, number> }>);

      const totalRegionalAmount = Object.values(regionalGrouped).reduce((sum, group) => sum + group.amount, 0);
      
      // Calculate percentages and sort services
      Object.keys(regionalGrouped).forEach(region => {
        regionalGrouped[region].percentage = parseFloat(((regionalGrouped[region].amount / totalRegionalAmount) * 100).toFixed(1));
        regionalGrouped[region].amount = parseFloat(regionalGrouped[region].amount.toFixed(2));
        
        // Sort services by cost within each region
        const sortedServices = Object.entries(regionalGrouped[region].services)
          .sort(([,a], [,b]) => b - a)
          .reduce((acc, [service, amount]) => {
            acc[service] = parseFloat(amount.toFixed(2));
            return acc;
          }, {} as Record<string, number>);
        regionalGrouped[region].services = sortedServices;
      });

      return {
        totalRecords: regionalCosts.length,
        totalAmount: totalRegionalAmount.toFixed(2),
        currency: 'USD',
        groupedBy: 'region',
        groups: regionalGrouped
      };
    }
    
    return super.executeTool(name, params);
  }
}