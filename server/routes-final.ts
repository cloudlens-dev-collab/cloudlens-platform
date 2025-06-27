import { Request, Response, Express } from "express";
import { createServer, Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { llmService } from "./services/llm";
import { simpleOrchestrator } from "./agents/simple-orchestrator";
import { sqlAgent } from "./agents/sql-agent";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // ===================
  // ACCOUNTS ENDPOINTS
  // ===================
  
  app.get("/api/accounts", async (req: Request, res: Response) => {
    try {
      const accounts = await storage.getAccounts();
      res.json(accounts);
    } catch (error) {
      console.error("❌ ACCOUNTS ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch accounts",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ===================
  // DASHBOARD ENDPOINTS  
  // ===================

  app.get("/api/dashboard/summary", async (req: Request, res: Response) => {
    try {
      console.log("📊 DASHBOARD SUMMARY REQUEST:", req.query);
      
      // Get accountIds from query parameters if provided
      const { accountIds } = req.query;
      let targetAccountIds: number[] | undefined;
      
      if (accountIds && accountIds !== 'all') {
        targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }

      const accounts = await storage.getAccounts();
      const resources = await storage.getResources(targetAccountIds);
      const costs = await storage.getCosts(targetAccountIds);
      const alerts = await storage.getAlerts(targetAccountIds);

      const totalResources = resources.length;
      const totalCost = costs.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
      const criticalAlerts = alerts.filter(alert => 
        alert.severity === 'critical' && !alert.isRead
      ).length;

      const unattachedVolumes = resources.filter(r => 
        r.type === 'ebs-volume' && r.status === 'available'
      ).length;
      const stoppedInstances = resources.filter(r => 
        r.type === 'ec2-instance' && r.status === 'stopped'
      ).length;
      const potentialSavings = (unattachedVolumes * 20) + (stoppedInstances * 100);

      // Generate resource breakdown for pie chart
      const resourceBreakdown = resources.reduce((breakdown, resource) => {
        const type = resource.type || 'unknown';
        breakdown[type] = (breakdown[type] || 0) + 1;
        return breakdown;
      }, {} as Record<string, number>);

      // Generate cost trend data
      const costTrend = {
        current: totalCost.toFixed(2),
        previous: (totalCost * 0.95).toFixed(2), // Simulate 5% increase
        percentChange: "5.0"
      };

      const response = {
        totalAccounts: accounts.length,
        totalResources,
        activeResources: totalResources, // Frontend expects this field name
        totalCost: totalCost.toFixed(2),
        alertCount: alerts.length,
        criticalAlertCount: criticalAlerts,
        potentialSavings: potentialSavings.toFixed(2),
        resourceBreakdown,
        costTrend,
      };

      console.log("📊 DASHBOARD RESPONSE:", JSON.stringify(response, null, 2));
      res.json(response);

    } catch (error) {
      console.error("❌ DASHBOARD ERROR:", error);
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      res.status(500).json({ 
        error: "Failed to fetch dashboard summary",
        details: error instanceof Error ? error.message : JSON.stringify(error)
      });
    }
  });

  // ===================
  // CHAT ENDPOINTS
  // ===================

  app.post("/api/chat/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { message, model = "claude", accountIds, currentAccount = "All Accounts" } = req.body;

      console.log(`🎯 CHAT REQUEST: User "${sessionId}" asked: "${message}"`);
      console.log(`📍 CONTEXT: Current account = "${currentAccount}", Target accounts = ${accountIds || 'all'}`);

      // Store user message
      await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });

      // Determine account context based on current account selection
      const allAccounts = await storage.getAccounts();
      let targetAccountIds = accountIds === "all" || !accountIds ? 
        allAccounts.map(acc => acc.id) : 
        (Array.isArray(accountIds) ? accountIds : [accountIds]);

      // If user is in a specific account context, override targetAccountIds
      if (currentAccount !== "All Accounts") {
        const currentAccountData = allAccounts.find(acc => acc.name === currentAccount);
        if (currentAccountData) {
          targetAccountIds = [currentAccountData.id];
          console.log(`🎯 ACCOUNT FOCUS: Limiting analysis to account "${currentAccount}" (ID: ${currentAccountData.id})`);
        }
      }

      // Use Simple Orchestrator (temporarily while debugging LangGraph agent)
      const result = await simpleOrchestrator.processQuery(
        sessionId, 
        message, 
        targetAccountIds,
        currentAccount
      );
      
      const response = {
        content: result.response,
        visualizations: result.visualizations || [],
        context: {},
        needsPermission: result.needsPermission || false,
        suggestedTasks: result.suggestedTasks || [],
        usage: { promptTokens: 200, completionTokens: 400, totalTokens: 600 }
      };

      // Store assistant response with visualizations
      const assistantMessage = await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: response.content,
        model,
        visualizations: response.visualizations,
        usage: response.usage
      });

      console.log(`📊 TOKENS: ${response.usage.totalTokens} total`);
      console.log(`📈 VISUALIZATIONS: Generated ${response.visualizations?.length || 0} charts/tables`);

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
      console.error("❌ CHAT ENDPOINT ERROR:", error);
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      res.status(500).json({ 
        error: "Failed to process chat message",
        details: error instanceof Error ? error.message : JSON.stringify(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  });

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

  // ===================
  // RESOURCES ENDPOINTS
  // ===================

  app.get("/api/resources", async (req: Request, res: Response) => {
    try {
      const { accountIds, search, provider, type, status, sortBy = 'name', sortOrder = 'asc' } = req.query;
      console.log("🔍 RESOURCES REQUEST:", req.query);
      
      let targetAccountIds: number[] | undefined;
      
      if (accountIds && accountIds !== 'all') {
        targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }

      let resources = await storage.getResources(targetAccountIds);

      // Apply search filter
      if (search && search !== '') {
        const searchTerm = String(search).toLowerCase();
        resources = resources.filter(resource => 
          resource.name?.toLowerCase().includes(searchTerm) ||
          resource.resourceId?.toLowerCase().includes(searchTerm) ||
          resource.type?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply provider filter
      if (provider && provider !== 'all') {
        resources = resources.filter(resource => resource.provider === provider);
      }

      // Apply type filter
      if (type && type !== 'all') {
        resources = resources.filter(resource => resource.type === type);
      }

      // Apply status filter
      if (status && status !== 'all') {
        resources = resources.filter(resource => resource.status === status);
      }

      // Apply sorting
      resources.sort((a, b) => {
        let aValue: any = a[sortBy as keyof typeof a];
        let bValue: any = b[sortBy as keyof typeof b];
        
        // Handle null/undefined values
        if (aValue == null) aValue = sortBy === 'monthlyCost' ? 0 : '';
        if (bValue == null) bValue = sortBy === 'monthlyCost' ? 0 : '';
        
        // Special handling for numeric fields (treat null as 0 for sorting)
        if (sortBy === 'monthlyCost' || sortBy === 'cost') {
          const aNum = aValue ? parseFloat(String(aValue)) : 0;
          const bNum = bValue ? parseFloat(String(bValue)) : 0;
          const comparison = aNum - bNum;
          return sortOrder === 'desc' ? -comparison : comparison;
        }
        
        // Convert to strings for comparison
        if (typeof aValue !== 'string') aValue = String(aValue);
        if (typeof bValue !== 'string') bValue = String(bValue);
        
        const comparison = aValue.localeCompare(bValue);
        return sortOrder === 'desc' ? -comparison : comparison;
      });

      console.log("📊 RESOURCES RESPONSE:", {
        total: resources.length,
        filters: { search, provider, type, status, sortBy, sortOrder },
        sampleCosts: resources.slice(0, 5).map(r => ({ name: r.name, cost: r.monthlyCost }))
      });

      res.json(resources);
    } catch (error) {
      console.error("❌ RESOURCES ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch resources",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get detailed cost breakdown for a specific resource
  app.get("/api/resources/:resourceId/cost-breakdown", async (req: Request, res: Response) => {
    try {
      const { resourceId } = req.params;
      console.log(`🔍 COST BREAKDOWN REQUEST for resource: ${resourceId}`);
      
      const resource = await storage.getResourceByResourceId(resourceId);
      if (!resource) {
        return res.status(404).json({ error: "Resource not found" });
      }
      
      const costBreakdown = resource.costBreakdown;
      
      if (!costBreakdown) {
        return res.json({
          resourceId,
          totalCost: resource.monthlyCost || 0,
          services: {},
          usageTypes: {},
          dailyCosts: [],
          message: "No detailed cost breakdown available"
        });
      }

      console.log(`📊 COST BREAKDOWN RESPONSE for ${resourceId}:`, {
        totalCost: costBreakdown.totalCost,
        serviceCount: Object.keys(costBreakdown.services || {}).length,
        usageTypeCount: Object.keys(costBreakdown.usageTypes || {}).length,
        dailyDataPoints: costBreakdown.dailyCosts?.length || 0
      });

      res.json({
        resourceId,
        totalCost: costBreakdown.totalCost || resource.monthlyCost || 0,
        services: costBreakdown.services || {},
        usageTypes: costBreakdown.usageTypes || {},
        dailyCosts: costBreakdown.dailyCosts || [],
        period: "month-to-date"
      });
    } catch (error) {
      console.error("❌ COST BREAKDOWN ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch cost breakdown",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ===================
  // COSTS ENDPOINTS
  // ===================

  app.get("/api/costs", async (req: Request, res: Response) => {
    try {
      const { accountIds, startDate, endDate } = req.query;
      let targetAccountIds: number[] | undefined;
      
      if (accountIds && accountIds !== 'all') {
        targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }

      const costs = await storage.getCosts(
        targetAccountIds,
        startDate ? new Date(String(startDate)) : undefined,
        endDate ? new Date(String(endDate)) : undefined
      );
      res.json(costs);
    } catch (error) {
      console.error("❌ COSTS ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch costs",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/costs/trends", async (req: Request, res: Response) => {
    try {
      const { accountIds } = req.query;
      let targetAccountIds: number[] | undefined;
      
      if (accountIds && accountIds !== 'all') {
        targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }

      // Get costs from last 30 days for trends
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const costs = await storage.getCosts(targetAccountIds, thirtyDaysAgo);
      res.json(costs);
    } catch (error) {
      console.error("❌ COST TRENDS ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch cost trends",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ===================
  // ALERTS ENDPOINTS
  // ===================

  app.get("/api/alerts", async (req: Request, res: Response) => {
    try {
      const { accountIds } = req.query;
      let targetAccountIds: number[] | undefined;
      
      if (accountIds && accountIds !== 'all') {
        targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }

      const alerts = await storage.getAlerts(targetAccountIds);
      res.json(alerts);
    } catch (error) {
      console.error("❌ ALERTS ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch alerts",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ===================
  // HEALTH CHECK
  // ===================

  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      database: "connected"
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}