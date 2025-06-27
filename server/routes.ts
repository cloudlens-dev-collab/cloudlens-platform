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

  // Cost breakdown endpoint for resources
  app.get("/api/resources/:resourceId/cost-breakdown", async (req, res) => {
    try {
      const resourceId = req.params.resourceId;
      
      // Simple mock cost breakdown for now
      const breakdown = {
        resourceId,
        totalCost: 100.50,
        services: {
          "EC2-Instance": 60.30,
          "EBS": 25.20,
          "Data Transfer": 15.00
        },
        usageTypes: {
          "BoxUsage": 60.30,
          "VolumeUsage": 25.20,
          "DataTransfer-Out": 15.00
        },
        dailyCosts: [
          { date: "2024-06-25", service: "EC2-Instance", cost: 2.01 },
          { date: "2024-06-26", service: "EC2-Instance", cost: 2.01 },
          { date: "2024-06-27", service: "EC2-Instance", cost: 2.01 }
        ],
        period: "current-month",
        message: "Cost breakdown for the current billing period"
      };
      
      res.json(breakdown);
    } catch (error) {
      console.error("Error fetching cost breakdown:", error);
      res.status(500).json({ error: "Failed to fetch cost breakdown" });
    }
  });

  // Helper functions
  function getResourceBreakdown(resources: any[]) {
    const breakdown: Record<string, number> = {};
    for (const resource of resources) {
      breakdown[resource.type] = (breakdown[resource.type] || 0) + 1;
    }
    return breakdown;
  }

  function getCostTrend(costs: any[]) {
    const current = costs.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
    // Simple trend calculation - you might want to make this more sophisticated
    const previous = current * 0.95; // Assume 5% growth
    const percentChange = ((current - previous) / previous * 100).toFixed(1);
    
    return {
      current: current.toFixed(2),
      previous: previous.toFixed(2),
      percentChange
    };
  }

  const httpServer = createServer(app);
  return httpServer;
}
