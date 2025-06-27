import { Request, Response, Express } from "express";
import { createServer, Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { llmService } from "./services/llm";

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
  // Clean Chat endpoint with database context approach
  app.post("/api/chat/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { message, model = "claude", accountIds } = req.body;

      console.log(`📥 CHAT REQUEST: User "${sessionId}" asked: "${message}" with model: ${model}, accounts: ${accountIds || 'all'}`);

      // Get conversation history
      const conversationHistory = await storage.getChatMessages(sessionId);

      // Store user message
      await storage.createChatMessage({
        sessionId,
        role: "user",
        content: message,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      });

      // Determine account context
      const allAccounts = await storage.getAccounts();
      const targetAccountIds = accountIds === "all" || !accountIds ? 
        allAccounts.map(acc => acc.id) : 
        (Array.isArray(accountIds) ? accountIds : [accountIds]);

      // Check if this is an infrastructure-related query
      const isInfraQuery = isInfrastructureQuery(message);
      console.log(`🔍 QUERY ANALYSIS: Infrastructure query detected: ${isInfraQuery}`);
      
      let response;

      // For ALL infrastructure queries, provide complete database context to LLM
      if (isInfraQuery) {
        try {
          console.log("🎯 DATABASE CONTEXT: Providing complete database context to LLM for investigation");
          
          // Load complete authentic database context
          const accounts = await storage.getAccounts();
          const costs = await storage.getCosts(targetAccountIds);
          const resources = await storage.getResources(targetAccountIds);
          const alerts = await storage.getAlerts(targetAccountIds);
          
          // Create optimized context for LLM analysis
          const totalCostFromRecords = costs.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
          
          // Group costs by region for efficient analysis
          const costsByRegion = costs.reduce((acc, cost) => {
            const region = cost.region || 'unknown';
            if (!acc[region]) {
              acc[region] = { total: 0, services: {}, count: 0 };
            }
            acc[region].total += parseFloat(cost.amount);
            acc[region].count++;
            
            const service = cost.service || 'unknown';
            if (!acc[region].services[service]) {
              acc[region].services[service] = 0;
            }
            acc[region].services[service] += parseFloat(cost.amount);
            return acc;
          }, {} as Record<string, any>);

          // Group resources by region and type for efficient analysis
          const resourcesByRegion = resources.reduce((acc, resource) => {
            const region = resource.region || 'unknown';
            if (!acc[region]) {
              acc[region] = { types: {}, totalCost: 0, count: 0 };
            }
            
            const type = resource.type || 'unknown';
            if (!acc[region].types[type]) {
              acc[region].types[type] = { count: 0, cost: 0, statuses: {} };
            }
            acc[region].types[type].count++;
            acc[region].types[type].cost += parseFloat(resource.monthlyCost || '0');
            acc[region].totalCost += parseFloat(resource.monthlyCost || '0');
            acc[region].count++;
            
            const status = resource.status || 'unknown';
            if (!acc[region].types[type].statuses[status]) {
              acc[region].types[type].statuses[status] = 0;
            }
            acc[region].types[type].statuses[status]++;
            return acc;
          }, {} as Record<string, any>);

          const analysisPrompt = `You are analyzing authentic cloud infrastructure data from a production environment.

INFRASTRUCTURE SUMMARY:
- Total Accounts: ${accounts.length}
- Total Resources: ${resources.length}
- Total Cost Records: ${costs.length} ($${totalCostFromRecords.toFixed(2)})
- Total Alerts: ${alerts.length}

ACCOUNT CONTEXT:
${accounts.map(acc => `${acc.name} (${acc.provider}) - ${acc.region || 'multi-region'}`).join('\n')}

COSTS BY REGION:
${Object.entries(costsByRegion)
  .sort(([,a], [,b]) => (b as any).total - (a as any).total)
  .map(([region, data]: [string, any]) => 
    `${region}: $${data.total.toFixed(2)} (${data.count} records)\n  Top Services: ${Object.entries(data.services)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([service, cost]) => `${service}: $${(cost as number).toFixed(2)}`)
      .join(', ')}`
  ).join('\n')}

RESOURCES BY REGION:
${Object.entries(resourcesByRegion)
  .sort(([,a], [,b]) => (b as any).totalCost - (a as any).totalCost)
  .map(([region, data]: [string, any]) => 
    `${region}: ${data.count} resources, $${data.totalCost.toFixed(2)}/month\n  Types: ${Object.entries(data.types)
      .sort(([,a], [,b]) => (b as any).count - (a as any).count)
      .slice(0, 5)
      .map(([type, info]: [string, any]) => `${type}(${info.count})`)
      .join(', ')}`
  ).join('\n')}

ALERTS SUMMARY:
${alerts.length > 0 ? alerts
  .filter(alert => !alert.isRead)
  .slice(0, 5)
  .map(alert => `${alert.severity}: ${alert.message}`)
  .join('\n') : 'No active alerts'}

User Question: "${message}"

Analyze the authentic infrastructure data above to answer the user's question. Use only the real data provided - no estimates or assumptions. Provide specific insights with exact numbers, regions, and patterns from the actual database records.`;

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

  // Other endpoints remain the same...
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
      const accounts = await storage.getAccounts();
      const resources = await storage.getResources();
      const costs = await storage.getCosts();
      const alerts = await storage.getAlerts();

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

      res.json({
        totalAccounts: accounts.length,
        totalResources,
        totalCost: totalCost.toFixed(2),
        alertCount: alerts.length,
        criticalAlertCount: criticalAlerts,
        potentialSavings: potentialSavings.toFixed(2),
      });
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}