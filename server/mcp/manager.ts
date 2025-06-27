import { EventEmitter } from 'events';
import { MCPServer } from './base';
import { CloudSyncMCPServer } from './cloud-sync-server';
import { LLMAnalyticsMCPServer } from './llm-analytics-server';
import { InfrastructureMCPServer } from './infrastructure-server';

export class MCPManager extends EventEmitter {
  private servers: Map<string, MCPServer> = new Map();
  private isInitialized = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize all MCP servers
      const cloudSyncServer = new CloudSyncMCPServer();
      const llmAnalyticsServer = new LLMAnalyticsMCPServer();
      const infrastructureServer = new InfrastructureMCPServer();

      this.servers.set('cloud-sync', cloudSyncServer);
      this.servers.set('llm-analytics', llmAnalyticsServer);
      this.servers.set('infrastructure', infrastructureServer);

      // Set up event forwarding
      for (const [name, server] of this.servers) {
        server.on('toolExecuted', (data) => {
          this.emit('toolExecuted', { server: name, ...data });
        });

        server.on('toolError', (data) => {
          this.emit('toolError', { server: name, ...data });
        });

        server.on('toolUsageRecorded', (data) => {
          this.emit('toolUsageRecorded', { server: name, ...data });
        });
      }

      this.isInitialized = true;
      this.emit('initialized');
      
      console.log('MCP Manager initialized with servers:', Array.from(this.servers.keys()));
    } catch (error) {
      console.error('Failed to initialize MCP Manager:', error);
      throw error;
    }
  }

  getServer(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  getAllServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  async executeToolOnServer(serverName: string, toolName: string, params: any, context?: any): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server '${serverName}' not found`);
    }

    return await server.executeTool(toolName, params, context);
  }

  async executeTool(toolName: string, params: any, context?: any): Promise<any> {
    // Find the first server that has the tool
    for (const [serverName, server] of this.servers) {
      if (server.getTools().some(tool => tool.name === toolName)) {
        return await server.executeTool(toolName, params, context);
      }
    }

    throw new Error(`Tool '${toolName}' not found in any server`);
  }

  getAllTools(): Array<{ server: string; tool: any }> {
    const tools: Array<{ server: string; tool: any }> = [];
    
    for (const [serverName, server] of this.servers) {
      server.getTools().forEach(tool => {
        tools.push({ server: serverName, tool });
      });
    }

    return tools;
  }

  getAllResources(): Array<{ server: string; resource: any }> {
    const resources: Array<{ server: string; resource: any }> = [];
    
    for (const [serverName, server] of this.servers) {
      server.getResources().forEach(resource => {
        resources.push({ server: serverName, resource });
      });
    }

    return resources;
  }

  getAllPrompts(): Array<{ server: string; prompt: any }> {
    const prompts: Array<{ server: string; prompt: any }> = [];
    
    for (const [serverName, server] of this.servers) {
      server.getPrompts().forEach(prompt => {
        prompts.push({ server: serverName, prompt });
      });
    }

    return prompts;
  }

  getAggregatedToolUsageStats(): any {
    const stats = {
      totalUsage: 0,
      successRate: 0,
      averageExecutionTime: 0,
      serverStats: new Map<string, any>(),
      mostUsedTools: new Map<string, number>(),
      recentErrors: [] as any[]
    };

    let totalSuccessful = 0;
    let totalExecutionTime = 0;
    let totalRequests = 0;

    for (const [serverName, server] of this.servers) {
      const serverStats = server.getToolUsageStats();
      stats.serverStats.set(serverName, serverStats);
      
      stats.totalUsage += serverStats.totalUsage;
      totalSuccessful += Math.round(serverStats.totalUsage * serverStats.successRate / 100);
      totalExecutionTime += serverStats.averageExecutionTime * serverStats.totalUsage;
      totalRequests += serverStats.totalUsage;

      // Aggregate most used tools
      serverStats.mostUsedTools.forEach(({ name, count }) => {
        const currentCount = stats.mostUsedTools.get(name) || 0;
        stats.mostUsedTools.set(name, currentCount + count);
      });

      // Aggregate recent errors
      stats.recentErrors.push(...serverStats.recentErrors.map(error => ({
        ...error,
        server: serverName
      })));
    }

    stats.successRate = totalRequests > 0 ? (totalSuccessful / totalRequests) * 100 : 0;
    stats.averageExecutionTime = totalRequests > 0 ? totalExecutionTime / totalRequests : 0;

    // Sort most used tools
    const sortedTools = Array.from(stats.mostUsedTools.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Sort recent errors by timestamp
    stats.recentErrors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    stats.recentErrors = stats.recentErrors.slice(0, 20);

    return {
      ...stats,
      mostUsedTools: sortedTools,
      serverStats: Object.fromEntries(stats.serverStats)
    };
  }

  async syncAccountData(accountId: number, force = false): Promise<any> {
    const cloudSyncServer = this.servers.get('cloud-sync');
    if (!cloudSyncServer) {
      throw new Error('Cloud sync server not available');
    }

    const resourcesResult = await cloudSyncServer.executeTool('sync_account_resources', { accountId, force });
    
    // Also sync costs for the last 30 days
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = new Date();
    
    const costsResult = await cloudSyncServer.executeTool('sync_account_costs', {
      accountId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    return {
      resources: resourcesResult,
      costs: costsResult,
      syncedAt: new Date()
    };
  }

  async getIntelligentModelRecommendation(query: string, accountContext?: string): Promise<any> {
    const llmAnalyticsServer = this.servers.get('llm-analytics');
    if (!llmAnalyticsServer) {
      throw new Error('LLM analytics server not available');
    }

    // Analyze query to determine type and complexity
    const queryType = this.analyzeQueryType(query);
    const complexity = this.analyzeQueryComplexity(query);

    return await llmAnalyticsServer.executeTool('recommend_optimal_model', {
      queryType,
      accountContext,
      complexity
    });
  }

  async trackLLMUsage(provider: string, model: string, usage: any): Promise<void> {
    const llmAnalyticsServer = this.servers.get('llm-analytics');
    if (!llmAnalyticsServer) {
      return; // Fail silently if analytics server is not available
    }

    await llmAnalyticsServer.executeTool('track_llm_usage', {
      provider,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      responseTime: usage.responseTime,
      success: usage.success,
      queryType: usage.queryType || 'general'
    });
  }

  private analyzeQueryType(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    if (/cost|price|billing|expense|budget|save|optimize|cheaper/i.test(query)) {
      return 'cost-analysis';
    }
    
    if (/resource|instance|server|database|storage|network|performance|scale|optimize/i.test(query)) {
      return 'resource-optimization';
    }
    
    if (/error|issue|problem|fail|debug|troubleshoot|fix|broken/i.test(query)) {
      return 'troubleshooting';
    }
    
    return 'general';
  }

  private analyzeQueryComplexity(query: string): string {
    const words = query.split(/\s+/).length;
    const hasMultipleQuestions = (query.match(/\?/g) || []).length > 1;
    const hasComplexTerms = /analyze|compare|optimize|integrate|implement|architect/i.test(query);
    
    if (words > 50 || hasMultipleQuestions || hasComplexTerms) {
      return 'complex';
    }
    
    if (words > 20 || /how|why|what|when|where/i.test(query)) {
      return 'moderate';
    }
    
    return 'simple';
  }

  shutdown(): void {
    for (const server of this.servers.values()) {
      server.removeAllListeners();
    }
    this.servers.clear();
    this.removeAllListeners();
    this.isInitialized = false;
  }
}

// Global MCP Manager instance
export const mcpManager = new MCPManager();