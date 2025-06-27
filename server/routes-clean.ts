import { Request, Response, Express } from "express";
import { createServer, Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { llmService } from "./services/llm";
import { simpleOrchestrator } from "./agents/simple-orchestrator";
import { sqlAgent } from "./agents/sql-agent";

function isInfrastructureQuery(message: string): boolean {
  const infraKeywords = [
    'cost', 'costs', 'spending', 'bill', 'billing', 'budget', 'price', 'pricing',
    'ec2', 'instance', 'instances', 'server', 'servers', 'compute',
    's3', 'bucket', 'buckets', 'storage', 'object',
    'ebs', 'volume', 'volumes', 'disk', 'disks',
    'rds', 'database', 'databases', 'db',
    'lambda', 'function', 'functions', 'serverless',
    'region', 'regions', 'availability', 'zone', 'zones',
    'vpc', 'network', 'networking', 'subnet', 'subnets',
    'security', 'group', 'groups', 'firewall',
    'resource', 'resources', 'infrastructure', 'aws', 'azure', 'cloud',
    'optimization', 'optimize', 'saving', 'savings', 'efficient',
    'utilization', 'performance', 'metrics', 'monitoring',
    'unattached', 'unused', 'idle', 'stopped', 'running',
    'lifecycle', 'policy', 'policies', 'management'
  ];
  
  const lowerMessage = message.toLowerCase();
  return infraKeywords.some(keyword => lowerMessage.includes(keyword));
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Simple test endpoint
  app.get("/api/test", (req: Request, res: Response) => {
    res.json({ message: "Server is working", timestamp: new Date().toISOString() });
  });

  // LangGraph Orchestrated Chat endpoint with rich visualizations
  app.post("/api/chat/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { message, model = "claude", accountIds, currentAccount = "All Accounts" } = req.body;

      console.log(`🎯 LANGGRAPH CHAT: User "${sessionId}" asked: "${message}"`);
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

      // Use Simple Orchestrator with permission flow
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

      // Store assistant response
      const assistantMessage = await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: response.content,
        model,
        usage: response.usage
      });

      // Add visualizations to the assistant message
      const enrichedAssistantMessage = {
        ...assistantMessage,
        visualizations: response.visualizations || []
      };

      console.log(`📊 TOKENS: ${response.usage.totalTokens} total (${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion)`);
      console.log(`📈 VISUALIZATIONS: Generated ${response.visualizations?.length || 0} charts/tables`);
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
        assistantMessage: enrichedAssistantMessage
      });

    } catch (error) {
      console.error("❌ CHAT ENDPOINT ERROR:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      res.status(500).json({ 
        error: "Failed to process chat message",
        details: error instanceof Error ? error.message : JSON.stringify(error),
        errorType: typeof error,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  });

  // Task approval endpoint for SQL Agent
  app.post("/api/chat/:sessionId/approve-tasks", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { approvedTaskIds } = req.body;

      console.log(`🎯 TASK APPROVAL: Session ${sessionId} approved tasks: ${approvedTaskIds.join(', ')}`);

      // Execute approved tasks
      const response = await sqlAgent.executePendingTasks(sessionId, approvedTaskIds);

      // Store the result as an assistant message
      const assistantMessage = await storage.createChatMessage({
        sessionId,
        role: "assistant",
        content: response,
        model: "sql-agent",
        usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 }
      });

      res.json({ assistantMessage });

    } catch (error) {
      console.error("Task approval error:", error);
      res.status(500).json({ 
        error: "Failed to execute approved tasks",
        details: error instanceof Error ? error.message : "Unknown error"
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

  // Dashboard summary endpoint
  app.get("/api/dashboard/summary", async (req, res) => {
    try {
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

      // Generate cost trend data (placeholder for now)
      const costTrend = {
        current: totalCost.toFixed(2),
        previous: (totalCost * 0.95).toFixed(2), // Simulate 5% increase
        percentChange: "5.0"
      };

      res.json({
        totalAccounts: accounts.length,
        totalResources,
        activeResources: totalResources, // Frontend expects this field name
        totalCost: totalCost.toFixed(2),
        alertCount: alerts.length,
        criticalAlertCount: criticalAlerts,
        potentialSavings: potentialSavings.toFixed(2),
        resourceBreakdown,
        costTrend,
      });
    } catch (error) {
      console.error("❌ DASHBOARD ERROR:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      res.status(500).json({ 
        error: "Failed to fetch dashboard summary",
        details: error instanceof Error ? error.message : JSON.stringify(error)
      });
    }
  });

  // Accounts endpoint
  app.get("/api/accounts", async (req: Request, res: Response) => {
    try {
      const accounts = await storage.getAccounts();
      res.json(accounts);
    } catch (error) {
      console.error("❌ ACCOUNTS ERROR:", error);
      res.status(500).json({ 
        error: "Failed to fetch accounts",
        details: error instanceof Error ? error.message : JSON.stringify(error)
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}