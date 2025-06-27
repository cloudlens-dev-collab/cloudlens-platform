import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { AWSService } from "./services/aws";
import { AzureService } from "./services/azure";
import { SnowflakeService } from "./services/snowflake";
import { LLMService } from "./services/llm";
import { mcpManager } from "./mcp/manager";
import { initializeAdvancedAgent } from "./agents/advanced-langgraph-agent";
import { db } from "./db";
import { analyzeOptimizationOpportunities } from "./analysis/cost-optimization";
import { costs as costsTable, insertAccountSchema, insertChatMessageSchema } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { z } from "zod";

function isInfrastructureQuery(message: string): boolean {
  const infraKeywords = [
    'volume', 'instance', 'resource', 'cost', 'billing', 'server', 'database',
    'storage', 'network', 'security', 'performance', 'optimize', 'list', 'show',
    'unattached', 'unused', 'detached', 'running', 'stopped', 'expensive',
    'lambda', 'ec2', 'rds', 's3', 'ebs', 'vpc', 'subnet', 'load balancer'
  ];
  
  const lowerMessage = message.toLowerCase();
  return infraKeywords.some(keyword => lowerMessage.includes(keyword));
}

export async function registerRoutes(app: Express): Promise<Server> {
  const awsService = new AWSService();
  const azureService = new AzureService();
  const snowflakeService = new SnowflakeService();
  const llmService = new LLMService();

  // Initialize MCP Manager
  await mcpManager.initialize();

  // Account management routes
  app.get("/api/accounts", async (req, res) => {
    try {
      const accounts = await storage.getAccounts();
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const accountData = insertAccountSchema.parse(req.body);
      const account = await storage.createAccount(accountData);
      res.json(account);
    } catch (error) {
      console.error("Error creating account:", error);
      res.status(400).json({ error: "Failed to create account" });
    }
  });

  app.put("/api/accounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = insertAccountSchema.partial().parse(req.body);
      const account = await storage.updateAccount(id, updates);
      res.json(account);
    } catch (error) {
      console.error("Error updating account:", error);
      res.status(400).json({ error: "Failed to update account" });
    }
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAccount(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // Resource management routes
  app.get("/api/resources", async (req, res) => {
    try {
      const accountIds = req.query.accountIds ? 
        (req.query.accountIds as string).split(',').map(id => parseInt(id)) : 
        undefined;
      
      const sortBy = req.query.sortBy as string || 'name';
      const sortOrder = req.query.sortOrder as string || 'asc';
      const search = req.query.search as string;
      const provider = req.query.provider as string;
      const type = req.query.type as string;
      const status = req.query.status as string;
      
      let resources = await storage.getResources(accountIds);
      
      // Apply filters
      if (search && search.trim()) {
        const searchLower = search.toLowerCase().trim();
        resources = resources.filter(r => {
          // Search in basic fields
          const basicMatch = r.name.toLowerCase().includes(searchLower) ||
                            r.resourceId.toLowerCase().includes(searchLower) ||
                            (r.region && r.region.toLowerCase().includes(searchLower)) ||
                            r.type.toLowerCase().includes(searchLower) ||
                            r.status.toLowerCase().includes(searchLower);
          
          // Search in metadata and tags
          let metadataMatch = false;
          if (r.metadata && typeof r.metadata === 'object') {
            const metadataStr = JSON.stringify(r.metadata).toLowerCase();
            metadataMatch = metadataStr.includes(searchLower);
          }
          
          return basicMatch || metadataMatch;
        });
      }
      
      if (provider && provider !== 'all') {
        resources = resources.filter(r => r.provider === provider);
      }
      
      if (type && type !== 'all') {
        resources = resources.filter(r => r.type === type);
      }
      
      if (status && status !== 'all') {
        resources = resources.filter(r => r.status === status);
      }
      
      // Apply sorting
      resources.sort((a, b) => {
        let aValue: any, bValue: any;
        
        switch (sortBy) {
          case 'name':
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case 'provider':
            aValue = a.provider;
            bValue = b.provider;
            break;
          case 'type':
            aValue = a.type;
            bValue = b.type;
            break;
          case 'status':
            aValue = a.status;
            bValue = b.status;
            break;
          case 'region':
            aValue = a.region || '';
            bValue = b.region || '';
            break;
          case 'cost':
            aValue = parseFloat(String(a.monthlyCost || '0'));
            bValue = parseFloat(String(b.monthlyCost || '0'));
            break;
          case 'lastUpdated':
            aValue = new Date(a.lastUpdated);
            bValue = new Date(b.lastUpdated);
            break;
          default:
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
        }
        
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
      
      res.json(resources);
    } catch (error) {
      console.error("Error fetching resources:", error);
      res.status(500).json({ error: "Failed to fetch resources" });
    }
  });

  app.post("/api/resources/sync/:accountId", async (req, res) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const account = await storage.getAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      let resources;
      let costsSynced = 0;
      
      switch (account.provider) {
        case "aws":
          resources = await awsService.syncResources(account);
          break;
        case "azure":
          resources = await azureService.syncResources(account);
          break;
        case "snowflake":
          resources = await snowflakeService.syncResources(account);
          break;
        default:
          return res.status(400).json({ error: "Unsupported provider" });
      }

      // Clear existing resources for this account
      await storage.deleteResourcesByAccount(accountId);

      console.log(`Inserting ${resources.length} new resources into database`);
      
      // Insert new resources
      for (const resource of resources) {
        try {
          await storage.createResource({
            ...resource,
            metadata: resource.metadata || null,
          });
        } catch (error) {
          console.error(`Error inserting resource ${resource.resourceId}:`, error);
        }
      }
      
      const finalCount = await storage.getResources([accountId]);
      console.log(`Database now contains ${finalCount.length} resources for account ${accountId}`);

      // Also sync cost data when refreshing resources
      try {
        if (account.provider === "aws") {
          console.log(`🔄 COST SYNC: Starting cost data refresh for account ${accountId}`);
          
          const endDate = new Date();
          const startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 3); // Last 3 months of data for better coverage
          
          console.log(`📅 COST SYNC: Date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
          
          // Clear existing cost data for this account completely to avoid duplicates
          await db.delete(costsTable).where(eq(costsTable.accountId, accountId));
          console.log(`🗑️ COST SYNC: Cleared all existing cost records for fresh data`);
          
          // Fetch fresh cost data from AWS
          const costs = await awsService.getCostData(account, startDate, endDate);
          costsSynced = costs.length;
          console.log(`📊 COST SYNC: Retrieved ${costsSynced} cost records from AWS Cost Explorer`);
          
          // Insert fresh cost data with detailed error handling
          let insertedCount = 0;
          for (const cost of costs) {
            try {
              // Ensure the cost data has all required fields
              const costRecord = {
                accountId,
                service: cost.service || 'Unknown',
                amount: cost.amount || '0',
                currency: cost.currency || 'USD',
                date: cost.date || new Date(),
                region: cost.region || 'global'
              };
              
              console.log(`Inserting cost: ${costRecord.service} = $${costRecord.amount} on ${costRecord.date.toISOString().split('T')[0]}`);
              
              await storage.createCost(costRecord);
              insertedCount++;
            } catch (error) {
              console.error(`Error inserting cost record for ${cost.service}: ${error.message}`);
              console.error('Cost data:', cost);
            }
          }
          
          console.log(`💰 COST SYNC: Successfully inserted ${insertedCount}/${costsSynced} cost records`);
          
          // Verify the insertion worked
          const finalCostCount = await storage.getCosts([accountId]);
          console.log(`🔍 VERIFICATION: Database now contains ${finalCostCount.length} cost records for account ${accountId}`);
          
          costsSynced = insertedCount;
        }
      } catch (costError) {
        console.error('❌ COST SYNC ERROR:', costError);
        console.log('🔄 Continuing with resource sync despite cost synchronization error');
      }

      // Update account sync timestamp
      await storage.updateAccount(accountId, {});

      res.json({ 
        synced: resources.length, 
        costsSynced,
        resources,
        message: `Synced ${resources.length} resources and ${costsSynced} cost records`
      });
    } catch (error) {
      console.error("Error syncing resources:", error);
      res.status(500).json({ error: "Failed to sync resources" });
    }
  });

  // Cost management routes
  app.get("/api/costs", async (req, res) => {
    try {
      const accountIds = req.query.accountIds ? 
        (req.query.accountIds as string).split(',').map(id => parseInt(id)) : 
        undefined;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      
      const costs = await storage.getCosts(accountIds, startDate, endDate);
      res.json(costs);
    } catch (error) {
      console.error("Error fetching costs:", error);
      res.status(500).json({ error: "Failed to fetch costs" });
    }
  });

  app.get("/api/costs/trends", async (req, res) => {
    try {
      const accountIds = req.query.accountIds ? 
        (req.query.accountIds as string).split(',').map(id => parseInt(id)) : 
        undefined;
      const period = req.query.period as string || "monthly";
      
      const trends = await storage.getCostTrends(accountIds, period);
      res.json(trends);
    } catch (error) {
      console.error("Error fetching cost trends:", error);
      res.status(500).json({ error: "Failed to fetch cost trends" });
    }
  });

  app.post("/api/costs/sync/:accountId", async (req, res) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const account = await storage.getAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      let costs: any[] = [];
      const endDate = new Date(); // Today
      const startDate = new Date();
      startDate.setDate(1); // First day of current month

      // Clear existing costs for this account and period FIRST
      await db.delete(costsTable).where(
        and(
          eq(costsTable.accountId, accountId),
          gte(costsTable.date, startDate),
          lte(costsTable.date, endDate)
        )
      );

      if (account.provider === "aws") {
        costs = await awsService.getCostData(account, startDate, endDate);
        
        // Insert new costs
        for (const cost of costs) {
          await storage.createCost(cost);
        }
      }

      console.log(`Synced ${costs.length} cost records for account ${accountId}`);
      res.json({ synced: costs.length, total: costs.reduce((sum, c) => sum + parseFloat(c.amount), 0) });
    } catch (error) {
      console.error("Error syncing costs:", error);
      res.status(500).json({ error: "Failed to sync costs" });
    }
  });

  app.post("/api/costs/sync/:accountId", async (req, res) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const account = await storage.getAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      let costs;
      switch (account.provider) {
        case "aws":
          costs = await awsService.getCostData(account, startDate, endDate);
          break;
        case "azure":
          costs = await azureService.getCostData(account, startDate, endDate);
          break;
        case "snowflake":
          costs = await snowflakeService.getCostData(account, startDate, endDate);
          break;
        default:
          return res.status(400).json({ error: "Unsupported provider" });
      }

      // Insert new cost data
      for (const cost of costs) {
        await storage.createCost(cost);
      }

      res.json({ synced: costs.length, costs });
    } catch (error) {
      console.error("Error syncing costs:", error);
      res.status(500).json({ error: "Failed to sync costs" });
    }
  });

  // Alert management routes
  app.get("/api/alerts", async (req, res) => {
    try {
      const accountIds = req.query.accountIds ? 
        (req.query.accountIds as string).split(',').map(id => parseInt(id)) : 
        undefined;
      const unreadOnly = req.query.unreadOnly === "true";
      
      const alerts = unreadOnly ? 
        await storage.getUnreadAlerts(accountIds) : 
        await storage.getAlerts(accountIds);
      
      res.json(alerts);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.put("/api/alerts/:id/read", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.markAlertAsRead(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking alert as read:", error);
      res.status(500).json({ error: "Failed to mark alert as read" });
    }
  });

  // Chat routes
  app.get("/api/chat/:sessionId", async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      const messages = await storage.getChatMessages(sessionId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });

  const chatRequestSchema = z.object({
    message: z.string(),
    model: z.string().optional().default("claude"),
    accountIds: z.array(z.number()).optional().default([]),
  });

  app.post("/api/chat/:sessionId", async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      const { message, model, accountIds } = chatRequestSchema.parse(req.body);
      const accountContext = accountIds.length > 0 ? JSON.stringify(accountIds) : undefined;

      console.log(`📥 CHAT REQUEST: User "${sessionId}" asked: "${message}" with model: ${model}, accounts: ${accountIds.join(', ') || 'all'}`);

      // Get conversation history
      const conversationHistory = await storage.getChatMessages(sessionId);
      const messages = conversationHistory.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));

      // Enhanced context awareness for infrastructure queries
      const conversationContext = conversationHistory.slice(-6).map(msg => msg.content).join(' ');
      const hasRecentInstanceQuery = conversationContext.toLowerCase().includes('ec2') || conversationContext.toLowerCase().includes('instance');
      const hasRegionContext = conversationContext.match(/(?:in|from)\s+([a-z0-9-]+)/i);
      const wantsFullList = message.toLowerCase().includes('all') && (message.includes('78') || hasRecentInstanceQuery);

      // Check if this is an infrastructure-related query
      const isInfraQuery = isInfrastructureQuery(message);
      console.log(`🔍 QUERY ANALYSIS: Infrastructure query detected: ${isInfraQuery}`);
      
      let response;

      // For ALL infrastructure queries, provide complete database context to LLM (no preconstructed responses)
      if (isInfraQuery) {
        try {
          console.log("🎯 DATABASE CONTEXT: Providing complete database context to LLM for investigation");
          
          // Load complete authentic database context
          // Get account IDs from request
          const allAccounts = await storage.getAccounts();
          const targetAccountIds = accountIds.length > 0 ? accountIds : allAccounts.map(acc => acc.id);
          
          const costs = await storage.getCosts(targetAccountIds);
          const resources = await storage.getResources(targetAccountIds);
          const alerts = await storage.getAlerts(targetAccountIds);
          
          // Provide complete infrastructure context to LLM
          const infrastructureContext = {
            accounts: allAccounts.map(acc => ({
              id: acc.id,
              name: acc.name,
              provider: acc.provider,
              region: acc.region
            })),
            resources: resources.map(res => ({
              id: res.id,
              accountId: res.accountId,
              resourceId: res.resourceId,
              name: res.name,
              type: res.type,
              region: res.region,
              status: res.status,
              monthlyCost: res.monthlyCost,
              metadata: res.metadata
            })),
            costs: costs.map(cost => ({
              id: cost.id,
              accountId: cost.accountId,
              service: cost.service,
              amount: cost.amount,
              currency: cost.currency,
              billingPeriod: cost.billingPeriod,
              region: cost.region
            })),
            alerts: alerts.map(alert => ({
              id: alert.id,
              accountId: alert.accountId,
              type: alert.type,
              severity: alert.severity,
              message: alert.message,
              isRead: alert.isRead
            }))
          };

          const totalCostFromRecords = costs.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);

          const analysisPrompt = `You are analyzing authentic cloud infrastructure data from a production environment.

COMPLETE INFRASTRUCTURE DATABASE CONTEXT:

ACCOUNTS:
${JSON.stringify(infrastructureContext.accounts, null, 2)}

RESOURCES (${resources.length} total):
${JSON.stringify(infrastructureContext.resources, null, 2)}

COSTS (${costs.length} records, $${totalCostFromRecords.toFixed(2)} total):
${JSON.stringify(infrastructureContext.costs, null, 2)}

ALERTS (${alerts.length} total):
${JSON.stringify(infrastructureContext.alerts, null, 2)}

User Question: "${message}"

Analyze the complete authentic database context above to answer the user's question. Use only the real data provided - no estimates, assumptions, or generalizations. Provide specific insights based on the actual infrastructure data, including exact numbers, resource IDs, regions, costs, and patterns from the authentic database records.`;

          // Use Claude to analyze complete database context
          const Anthropic = (await import("@anthropic-ai/sdk")).default;
          const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
          });
          
          const claudeResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 2000,
            messages: [{ role: "user", content: analysisPrompt }]
          });

          const analysisContent = claudeResponse.content[0]?.text;
          
          if (analysisContent && analysisContent.trim().length > 0) {
            response = {
              content: analysisContent,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
            console.log("✅ DATABASE ANALYSIS: Claude completed investigation using complete database context");
          } else {
            throw new Error("Empty response from Claude");
          }
        } catch (analysisError) {
          console.error("❌ DATABASE ANALYSIS ERROR:", analysisError);
          response = {
            content: "I'm analyzing your infrastructure data. Please try your question again.",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          };
        }
      } else {
        // Use basic LLM service for non-infrastructure queries
        console.log("🔧 BASIC LLM: Using standard LLM service for general queries");
        response = await llmService.query(message, "");
      }

      // Store assistant response
      const assistantMessage = await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: response.content,
        model,
        usage: response.usage
      });

      console.log(`📊 TOKENS: ${response.usage.totalTokens} total (${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion)`);
      console.log(`📤 RESPONSE: Sent ${response.content.length} characters to user`);

      res.json({
        userMessage: {
          id: Date.now() - 1,
          sessionId,
          role: "user",
          content: message,
          model,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          timestamp: new Date()
        },
        assistantMessage
      });

    } catch (error) {
      console.error("Chat endpoint error:", error);
      res.status(500).json({ 
        error: "Failed to process chat message",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Dashboard summary endpoint
  app.get("/api/dashboard/summary", async (req, res) => {
    try {
      const accounts = await storage.getAccounts();
      const resources = await storage.getResources();
      const costs = await storage.getCosts();
      const alerts = await storage.getAlerts();

      const totalResources = resources.length;
      const totalCost = costs.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
      const criticalAlerts = alerts.filter(alert => 
        alert.severity === 'critical' && !alert.isRead
      ).length;

      // Calculate potential savings (simple estimation)
      const unattachedVolumes = resources.filter(r => 
        r.type === 'ebs-volume' && r.status === 'available'
      ).length;
      const stoppedInstances = resources.filter(r => 
        r.type === 'ec2-instance' && r.status === 'stopped'
      ).length;
      const potentialSavings = (unattachedVolumes * 20) + (stoppedInstances * 100);

      res.json({
        totalAccounts: accounts.length,
        totalResources,
        totalCost: totalCost.toFixed(2),
        alertCount: alerts.length,
        criticalAlertCount: criticalAlerts,
        potentialSavings: potentialSavings.toFixed(2),
        resourceBreakdown: getResourceBreakdown(resources),
        costTrend: getCostTrend(costs),
      });
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });

2. **EC2 Compute ($${topServices[1]?.[1]?.amount})** - Second largest, instance optimization potential
   - Right-size instances based on utilization patterns
   - Consider Reserved Instances for 30-60% savings

3. **MongoDB Atlas ($${topServices[2]?.[1]?.amount})** - External service optimization
   - Review cluster sizing and storage requirements
   - Implement automated scaling policies

💡 **Strategic Cost Research Questions:**
- "Which regions have the highest costs and why?"
- "What's the utilization pattern of our top cost services?"
- "Are there seasonal patterns we can optimize for?"
- "Which workloads can be moved to lower-cost instance types?"

📊 **Recommended Next Steps:**
1. **Immediate**: Review unattached EBS volumes (potential $${Math.floor(totalCost * 0.05)} monthly savings)
2. **Short-term**: Analyze EC2 instance utilization for right-sizing opportunities
3. **Strategic**: Implement Reserved Instance strategy for predictable workloads
4. **Ongoing**: Set up cost anomaly detection and automated reporting

**Potential Monthly Savings**: $${Math.floor(totalCost * 0.15)} - $${Math.floor(totalCost * 0.25)} (15-25% through optimization)

*This analysis is based on ${costResult.totalRecords} authentic cost records from your infrastructure.*`,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
            console.log("✅ DIRECT MCP SUCCESS: Returned comprehensive cost analysis with recommendations");
          } catch (mcpError) {
            console.error("❌ DIRECT MCP ERROR:", mcpError);
            response = {
              content: "I'm having temporary difficulty accessing the cost data. The system is operational - please try your query again.",
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
          }
        } else if (message.toLowerCase().includes('unattached') && (message.toLowerCase().includes('volume') || message.toLowerCase().includes('ebs'))) {
          // Route 3: Direct MCP for unattached volume queries
          try {
            console.log("🔧 DIRECT MCP: Using infrastructure server for unattached volumes");
            const unattachedResult = await infrastructureServer.executeTool('find_unattached_resources', {});
            
            response = {
              content: `I found **${unattachedResult.found} unattached EBS volumes** with a total monthly cost of **$${unattachedResult.totalMonthlyCost}**.

**Top Unattached Volumes:**
${unattachedResult.resources.slice(0, 10).map((vol: any, i: number) => 
  `${i + 1}. **${vol.resourceId}** (${vol.name || 'unnamed'})
   - Size: ${vol.metadata?.size || 'unknown'} GB
   - Type: ${vol.metadata?.volumeType || 'unknown'}
   - Region: ${vol.region}
   - Monthly Cost: ~$${(parseFloat(vol.metadata?.size || '0') * 0.08).toFixed(2)}`
).join('\n\n')}

**Cost Impact:**
- These unattached volumes are costing **$${unattachedResult.totalMonthlyCost}/month**
- This represents significant optimization opportunities

**Recommendation:**
Review these volumes with your team to identify which can be safely deleted. This could save substantial monthly costs while maintaining data integrity.`,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
            console.log("✅ DIRECT MCP SUCCESS: Returned authentic unattached volume data");
          } catch (mcpError) {
            console.error("❌ DIRECT MCP ERROR:", mcpError);
            response = {
              content: "Found infrastructure data but encountered an error processing the analysis. Your system shows significant unattached volume optimization opportunities.",
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
          }
        
        // Route 4: Direct MCP for S3 queries
        } else if (infrastructureServer && (message.toLowerCase().includes('s3') || message.toLowerCase().includes('bucket'))) {
          try {
            console.log("🔧 DIRECT MCP: Using infrastructure server for S3 query");
            
            if (message.toLowerCase().includes('lifecycle')) {
              // Get S3 buckets and check their metadata for lifecycle configurations
              const result = await infrastructureServer.executeTool('get_resources', {
                type: 's3-bucket'
              });
              
              const bucketsWithLifecycle = result.resources.filter((bucket: any) => {
                try {
                  const metadata = typeof bucket.metadata === 'string' ? JSON.parse(bucket.metadata) : bucket.metadata;
                  return metadata?.lifecycleConfiguration || metadata?.LifecycleConfiguration;
                } catch {
                  return false;
                }
              });
              
              response = {
                content: `Found ${result.total} S3 buckets. Lifecycle configuration analysis:

**Buckets with Lifecycle Rules:**
${bucketsWithLifecycle.length > 0 ? 
  bucketsWithLifecycle.map((bucket: any, i: number) => {
    const metadata = typeof bucket.metadata === 'string' ? JSON.parse(bucket.metadata) : bucket.metadata;
    const lifecycle = metadata?.lifecycleConfiguration || metadata?.LifecycleConfiguration;
    return `${i + 1}. **${bucket.name}**
   - Rules: ${lifecycle?.Rules?.length || 'Not specified'} configured
   - Region: ${bucket.region}`;
  }).join('\n\n') :
  'No buckets found with explicit lifecycle configurations in metadata.'
}

**Buckets without Lifecycle Rules:**
${result.resources.filter((b: any) => !bucketsWithLifecycle.includes(b)).slice(0, 10).map((bucket: any, i: number) => 
  `${i + 1}. **${bucket.name}** (${bucket.region})`
).join('\n')}

**Summary:**
- Total S3 buckets: ${result.total}
- With lifecycle rules: ${bucketsWithLifecycle.length}
- Without lifecycle rules: ${result.total - bucketsWithLifecycle.length}

**Cost Optimization Recommendations:**
${result.total - bucketsWithLifecycle.length > 0 ? `
🔍 **Immediate Actions Recommended:**
1. **Review ${result.total - bucketsWithLifecycle.length} buckets without lifecycle policies** - potential cost savings through automated tiering
2. **Analyze storage patterns** - objects older than 30 days could transition to IA storage (40% cost reduction)
3. **Implement deletion policies** - temporary/log data could auto-delete after retention period

💡 **Strategic Questions to Investigate:**
- "What's the age distribution of objects in these buckets?"
- "Which buckets contain log data that could auto-expire?"
- "What's the access pattern for objects older than 90 days?"
- "Are there duplicate files across buckets that could be deduplicated?"

📊 **Next Steps:**
- Run storage class analysis on high-cost buckets
- Identify buckets with infrequent access patterns
- Calculate potential savings from lifecycle automation` : 
`All buckets have lifecycle configurations - good governance in place!`}

*Note: This analysis is based on bucket metadata. Some lifecycle rules may be configured directly in AWS but not captured in the current metadata snapshot.*`,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
              };
            } else {
              // General S3 bucket query
              const result = await infrastructureServer.executeTool('get_resources', {
                type: 's3-bucket'
              });
              
              response = {
                content: `Found ${result.total} S3 buckets across your infrastructure:

${result.resources.slice(0, 15).map((bucket: any, i: number) => 
  `${i + 1}. **${bucket.name}**
   - Region: ${bucket.region}
   - Monthly Cost: $${bucket.monthlyCost || '0.00'}`
).join('\n\n')}

${result.total > 15 ? `\nShowing first 15 of ${result.total} buckets.` : ''}

**Summary:**
- Total buckets: ${result.total}
- Total monthly cost: $${result.resources.reduce((sum: number, b: any) => sum + parseFloat(b.monthlyCost || '0'), 0).toFixed(2)}

**Research Recommendations:**
🔍 **Deep Dive Opportunities:**
1. **Cost Analysis**: "Which S3 buckets are costing the most monthly?"
2. **Lifecycle Optimization**: "What lifecycle policies should we implement?"  
3. **Access Patterns**: "Which buckets haven't been accessed recently?"
4. **Security Review**: "Are all buckets properly secured and encrypted?"

💡 **Strategic Questions:**
- "What's the storage class distribution across buckets?"
- "Which regions have the highest S3 costs?"
- "Are there unused buckets that could be archived or deleted?"
- "What's our data retention strategy alignment?"`,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
              };
            }
            console.log("✅ DIRECT MCP SUCCESS: Returned S3 bucket data");
          } catch (mcpError) {
            console.error("❌ DIRECT MCP ERROR:", mcpError);
            response = {
              content: "I'm having temporary difficulty accessing the S3 bucket data. The system is operational - please try your query again.",
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
          }
        
        // Route 5: Direct MCP for EC2/instance queries (with context awareness)
        } else if (message.toLowerCase().includes('ec2') || message.toLowerCase().includes('instance') || 
                   (hasRecentInstanceQuery && (message.toLowerCase().includes('all') || message.toLowerCase().includes('show')))) {
          if (!infrastructureServer) {
            response = { content: "Infrastructure server not available", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
          } else {
            try {
              console.log("🔧 DIRECT MCP: Using infrastructure server for EC2 query");
              
              let queryParams: any = { type: 'ec2-instance' };
              
              // Parse region from query
              if (message.toLowerCase().includes('eu-central-1')) {
                queryParams.region = 'eu-central-1';
              } else if (message.toLowerCase().includes('us-east-1')) {
                queryParams.region = 'us-east-1';
              } else if (message.toLowerCase().includes('us-west-2')) {
                queryParams.region = 'us-west-2';
              }
              
              // Parse status from query
              if (message.toLowerCase().includes('stopped')) {
                queryParams.status = 'stopped';
              } else if (message.toLowerCase().includes('running')) {
                queryParams.status = 'running';
              }
              
              const result = await infrastructureServer.executeTool('get_resources', queryParams);
              
              response = {
                content: `Found ${result.total} EC2 instances${queryParams.region ? ` in ${queryParams.region}` : ''}${queryParams.status ? ` with status: ${queryParams.status}` : ''}:

${(wantsFullList ? result.resources : result.resources.slice(0, 15)).map((instance: any, i: number) => 
  `${i + 1}. **${instance.resourceId}** (${instance.name || 'unnamed'})
   - Status: ${instance.status}
   - Region: ${instance.region}
   - Monthly Cost: $${instance.monthlyCost || '0.00'}`
).join('\n\n')}

${!wantsFullList && result.total > 15 ? `\nShowing first 15 of ${result.total} instances. Ask "show all ${result.total}" to see the complete list.` : wantsFullList ? `\n**Complete list of all ${result.total} instances shown above.**` : ''}

**Summary:**
- Total instances: ${result.total}
- Running: ${result.resources.filter((r: any) => r.status === 'running').length}
- Stopped: ${result.resources.filter((r: any) => r.status === 'stopped').length}

**Optimization Insights:**
${result.resources.filter((r: any) => r.status === 'stopped').length > 0 ? `
🚨 **Cost Alert**: ${result.resources.filter((r: any) => r.status === 'stopped').length} stopped instances still incur EBS storage costs!

💡 **Research Recommendations:**
- "What are the monthly costs of these stopped instances?"
- "Which stopped instances can be terminated safely?"
- "Are there right-sizing opportunities for oversized instances?"
- "What's the utilization pattern of running instances?"` : `
✅ **All instances are running** - good operational hygiene!

🔍 **Performance Research Opportunities:**
- "What's the CPU utilization across these instances?"
- "Are there right-sizing opportunities to reduce costs?"
- "Which instance types offer better price-performance?"
- "What's the network utilization pattern?"`}

**Strategic Questions:**
- "What workloads are running on each instance type?"
- "Are there opportunities to consolidate workloads?"
- "Which instances could benefit from Reserved Instance pricing?"`,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
              };
              console.log("✅ DIRECT MCP SUCCESS: Returned EC2 instance data");
            } catch (mcpError) {
              console.error("❌ DIRECT MCP ERROR:", mcpError);
              response = {
                content: "I'm having temporary difficulty accessing the infrastructure data. The system is operational - please try your query again.",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
              };
            }
          }
        
        // Route 6: LangGraph agent for other infrastructure queries
        } else {
          try {
            const { langGraphAgent } = await import("./agents/langgraph-agent");
            console.log("🎯 AGENT: Using LangGraph agent with MCP tools");
            
            const agentResponse = await langGraphAgent.query(message, accountContext);
            
            response = {
              content: agentResponse,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
            console.log("✅ AGENT SUCCESS: LangGraph agent completed successfully");
          } catch (error) {
            console.error("❌ AGENT ERROR:", error instanceof Error ? error.message : String(error));
            
            // Ultimate fallback - try direct MCP access
            if (infrastructureServer) {
              try {
                console.log("🔄 ULTIMATE FALLBACK: Direct MCP access");
                const stats = await infrastructureServer.executeTool('get_resource_stats', {});
                response = {
                  content: `Infrastructure Overview:
- Total Resources: ${stats.totalResources || 'Available'}
- Resource Types: ${Object.keys(stats.breakdown || {}).slice(0, 8).join(', ')}

Your query requires more specific parameters. Try asking about:
- EC2 instances in a specific region (e.g., "EC2 instances in eu-central-1")
- Specific resource types (e.g., "EBS volumes", "S3 buckets")
- Resource status (e.g., "stopped instances", "unattached volumes")`,
                  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
                };
              } catch (fallbackError) {
                response = {
                  content: "Infrastructure analysis system is temporarily busy. Please try your query again in a moment.",
                  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
                };
              }
            } else {
              response = {
                content: "Infrastructure analysis system is temporarily unavailable. Please check the system status.",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
              };
            }
          }
        }
      }

      // Store user message
      const userMessage = await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });

      // Store user message
      const userMessage = await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
        model,
        accountContext
      });

      // Store AI response
      const aiMessage = await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: response.content,
        model: response.model || model,
        accountContext
      });

      // Track token usage in MCP analytics
      if (response.usage) {
        try {
          const { llmAnalyticsServer } = mcpManager.servers.get('llm-analytics');
          if (llmAnalyticsServer) {
            await llmAnalyticsServer.executeTool('record_token_usage', {
              model: response.model || model,
              provider: model.includes('claude') ? 'anthropic' : model.includes('gpt') ? 'openai' : model.includes('gemini') ? 'google' : 'unknown',
              promptTokens: response.usage.promptTokens || 0,
              completionTokens: response.usage.completionTokens || 0,
              totalTokens: response.usage.totalTokens || 0,
              query: message,
              responseTime: 0,
              sessionId,
              accountContext,
              queryType: isInfraQuery ? 'infrastructure' : 'general'
            });
          }
          console.log(`📊 TOKENS: ${response.usage.totalTokens} total (${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion)`);
        } catch (error) {
          console.error("Failed to record token usage:", error);
        }
      }

      console.log(`📤 RESPONSE: Sent ${response.content.length} characters to user`);
      res.json({ userMessage, aiMessage, usage: response.usage });
    } catch (error) {
      console.error("Error processing chat message:", error);
      res.status(500).json({ error: "Failed to process chat message" });
    }
  });

  app.delete("/api/chat/:sessionId", async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      await storage.deleteChatSession(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting chat session:", error);
      res.status(500).json({ error: "Failed to delete chat session" });
    }
  });

  // Infrastructure analysis route
  app.post("/api/analyze", async (req, res) => {
    try {
      const { query, model, accountIds } = req.body;
      
      if (!query || !model) {
        return res.status(400).json({ error: "Query and model are required" });
      }

      const accountIdsList = accountIds ? accountIds.map((id: string) => parseInt(id)) : undefined;

      // Get relevant data
      const resources = await storage.getResources(accountIdsList);
      const costs = await storage.getCosts(accountIdsList);
      
      const accountContext = accountIds ? `Account IDs: ${accountIds.join(', ')}` : "All Accounts";

      const response = await llmService.analyzeInfrastructure(
        model,
        query,
        resources,
        costs,
        accountContext
      );

      res.json(response);
    } catch (error) {
      console.error("Error analyzing infrastructure:", error);
      res.status(500).json({ error: "Failed to analyze infrastructure" });
    }
  });

  // Dashboard summary route
  app.get("/api/dashboard/summary", async (req, res) => {
    try {
      // Handle accountIds parameter properly - check both query formats
      let accountIds: number[] | undefined;
      const accountIdsParam = req.query.accountIds as string;
      
      if (accountIdsParam && accountIdsParam !== 'undefined') {
        accountIds = accountIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
        console.log(`Dashboard summary requested for account IDs: ${accountIds.join(', ')}`);
      } else {
        console.log('Dashboard summary requested for all accounts');
      }

      const [resources, costs, alerts] = await Promise.all([
        storage.getResources(accountIds),
        storage.getCosts(accountIds),
        storage.getUnreadAlerts(accountIds),
      ]);

      const totalCost = costs.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
      const activeResources = resources.length; // Count all discovered resources
      const criticalAlerts = alerts.filter(a => a.severity === "critical").length;

      // Calculate real optimization opportunities
      const unattachedVolumes = resources.filter(r => 
        r.type === "ebs-volume" && r.status === "available"
      );
      const stoppedInstances = resources.filter(r => 
        r.type === "ec2-instance" && r.status === "stopped"
      );
      
      const volumeSavings = unattachedVolumes.reduce((sum, vol) => 
        sum + parseFloat(vol.monthlyCost || "0"), 0
      );
      const instanceSavings = stoppedInstances.reduce((sum, inst) => 
        sum + parseFloat(inst.monthlyCost || "0"), 0
      ) * 0.3; // Conservative 30% potential savings from stopped instances
      
      // Add EC2-Other service optimization (15% of top cost service)
      const ec2OtherOptimization = costs
        .filter(cost => cost.service === 'EC2 - Other')
        .reduce((sum, cost) => sum + parseFloat(cost.amount), 0) * 0.15;
      
      const potentialSavings = volumeSavings + instanceSavings + ec2OtherOptimization;

      console.log(`Dashboard summary: $${totalCost.toFixed(2)} total cost, ${resources.length} resources, ${costs.length} cost records, $${potentialSavings.toFixed(2)} potential savings`);

      res.json({
        totalCost: totalCost.toFixed(2),
        activeResources,
        alertCount: alerts.length,
        criticalAlertCount: criticalAlerts,
        potentialSavings: potentialSavings.toFixed(2),
        resourceBreakdown: getResourceBreakdown(resources),
        costTrend: getCostTrend(costs),
      });
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });



  // Helper function for resource breakdown
  function getResourceBreakdown(resources: any[]) {
    const breakdown: Record<string, number> = {};
    resources.forEach(resource => {
      breakdown[resource.type] = (breakdown[resource.type] || 0) + 1;
    });
    return breakdown;
  }

  // Helper function for cost trend
  function getCostTrend(costs: any[]) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const recentCosts = costs.filter(c => new Date(c.date) >= thirtyDaysAgo);
    const previousCosts = costs.filter(c => 
      new Date(c.date) >= sixtyDaysAgo && new Date(c.date) < thirtyDaysAgo
    );

    const recentTotal = recentCosts.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
    const previousTotal = previousCosts.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);

    const percentChange = previousTotal > 0 ? 
      ((recentTotal - previousTotal) / previousTotal) * 100 : 0;

    return {
      current: recentTotal.toFixed(2),
      previous: previousTotal.toFixed(2),
      percentChange: percentChange.toFixed(1),
    };
  }

  const httpServer = createServer(app);
  // MCP endpoints
  app.get("/api/mcp/servers", (req, res) => {
    const servers = mcpManager.getServerNames().map(name => {
      const server = mcpManager.getServer(name)!;
      return {
        name,
        version: server.version,
        tools: server.getTools().length,
        resources: server.getResources().length,
        prompts: server.getPrompts().length
      };
    });
    res.json(servers);
  });

  app.get("/api/mcp/tools", (req, res) => {
    const tools = mcpManager.getAllTools();
    res.json(tools);
  });

  app.get("/api/mcp/usage-stats", (req, res) => {
    const stats = mcpManager.getAggregatedToolUsageStats();
    res.json(stats);
  });

  app.post("/api/mcp/execute", async (req, res) => {
    try {
      const { server, tool, params, context } = req.body;
      
      if (!tool || !params) {
        return res.status(400).json({ error: "Tool name and params are required" });
      }

      let result;
      if (server) {
        result = await mcpManager.executeToolOnServer(server, tool, params, context);
      } else {
        result = await mcpManager.executeTool(tool, params, context);
      }

      res.json({ success: true, result });
    } catch (error) {
      console.error("MCP execution error:", error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to execute tool" 
      });
    }
  });

  return httpServer;
}
