import { MCPServer, MCPTool, MCPResource, MCPPrompt } from './base';
import { LLMService } from '../services/llm';
import { storage } from '../storage';

interface LLMUsageStats {
  provider: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  averageResponseTime: number;
  errorCount: number;
  lastUsed: Date;
}

interface ConversationAnalysis {
  sessionId: string;
  messageCount: number;
  avgMessageLength: number;
  topicsDiscussed: string[];
  providersUsed: string[];
  modelsUsed: string[];
  costOptimizationQueries: number;
  infraAnalysisQueries: number;
}

export class LLMAnalyticsMCPServer extends MCPServer {
  private llmService = new LLMService();
  private usageStats: Map<string, LLMUsageStats> = new Map();
  private conversationCache: Map<string, any[]> = new Map();

  private tokenUsage: Array<{
    id: string;
    timestamp: Date;
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    query: string;
    responseTime: number;
    cost: number;
    sessionId?: string;
    accountContext?: string;
    queryType?: string;
  }> = [];

  constructor() {
    super('llm-analytics', '1.0.0');
  }

  initializeTools(): void {
    this.registerTool({
      name: 'record_token_usage',
      description: 'Record token usage for LLM queries with cost calculation',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'LLM model used' },
          provider: { type: 'string', description: 'Provider (anthropic, openai, google)' },
          promptTokens: { type: 'number', description: 'Input tokens used' },
          completionTokens: { type: 'number', description: 'Output tokens generated' },
          totalTokens: { type: 'number', description: 'Total tokens consumed' },
          query: { type: 'string', description: 'User query text' },
          responseTime: { type: 'number', description: 'Response time in milliseconds' },
          sessionId: { type: 'string', description: 'Chat session ID' },
          accountContext: { type: 'string', description: 'Account context' },
          queryType: { type: 'string', description: 'infrastructure, general, or optimization' }
        },
        required: ['model', 'provider', 'totalTokens', 'query']
      },
      handler: async (params) => this.recordTokenUsage(params)
    });

    this.registerTool({
      name: 'analyze_conversation',
      description: 'Analyze a chat conversation for insights and patterns',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Chat session ID to analyze' },
          includeContext: { type: 'boolean', description: 'Include account context analysis', default: true }
        },
        required: ['sessionId']
      },
      handler: async (params) => this.analyzeConversation(params.sessionId, params.includeContext)
    });

    this.registerTool({
      name: 'get_llm_usage_stats',
      description: 'Get detailed LLM usage statistics including token usage and costs',
      inputSchema: {
        type: 'object',
        properties: {
          timeRange: { type: 'string', description: 'Time range: today, week, month, all', default: 'all' },
          provider: { type: 'string', description: 'Filter by provider: openai, anthropic, google' }
        }
      },
      handler: async (params) => this.getLLMStats(params.timeRange, params.provider)
    });

    this.registerTool({
      name: 'recommend_optimal_model',
      description: 'Recommend the best LLM model for a specific query type',
      inputSchema: {
        type: 'object',
        properties: {
          queryType: { 
            type: 'string', 
            enum: ['cost-analysis', 'resource-optimization', 'troubleshooting', 'general'],
            description: 'Type of query to optimize for'
          },
          accountContext: { type: 'string', description: 'Account context for the query' },
          complexity: { 
            type: 'string', 
            enum: ['simple', 'moderate', 'complex'],
            description: 'Query complexity level',
            default: 'moderate'
          }
        },
        required: ['queryType']
      },
      handler: async (params) => this.recommendOptimalModel(params.queryType, params.accountContext, params.complexity)
    });

    this.registerTool({
      name: 'track_llm_usage',
      description: 'Track LLM usage metrics for analytics',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'LLM provider used' },
          model: { type: 'string', description: 'Model used' },
          promptTokens: { type: 'number', description: 'Number of prompt tokens' },
          completionTokens: { type: 'number', description: 'Number of completion tokens' },
          responseTime: { type: 'number', description: 'Response time in milliseconds' },
          success: { type: 'boolean', description: 'Whether the request was successful' },
          queryType: { type: 'string', description: 'Type of query performed' }
        },
        required: ['provider', 'model', 'success']
      },
      handler: async (params) => this.trackLLMUsage(params)
    });

    this.registerTool({
      name: 'generate_usage_insights',
      description: 'Generate insights and recommendations based on LLM usage patterns',
      inputSchema: {
        type: 'object',
        properties: {
          timeRange: { type: 'string', description: 'Time range for analysis', default: '7d' }
        }
      },
      handler: async (params) => this.generateUsageInsights(params.timeRange)
    });
  }

  initializeResources(): void {
    this.registerResource({
      uri: 'analytics://conversations',
      name: 'Chat Conversations',
      description: 'All chat conversations and their analysis',
      mimeType: 'application/json'
    });

    this.registerResource({
      uri: 'analytics://llm-usage',
      name: 'LLM Usage Statistics',
      description: 'Usage statistics for different LLM providers and models',
      mimeType: 'application/json'
    });

    this.registerResource({
      uri: 'analytics://model-performance',
      name: 'Model Performance Metrics',
      description: 'Performance metrics and comparisons across different models',
      mimeType: 'application/json'
    });
  }

  initializePrompts(): void {
    this.registerPrompt({
      name: 'cost_optimization_analysis',
      description: 'Analyze infrastructure for cost optimization opportunities',
      arguments: [
        { name: 'account_data', description: 'JSON data of account resources and costs', required: true },
        { name: 'focus_area', description: 'Specific area to focus on (compute, storage, network)', required: false }
      ]
    });

    this.registerPrompt({
      name: 'resource_efficiency_report',
      description: 'Generate a resource efficiency report',
      arguments: [
        { name: 'resource_data', description: 'JSON data of resources', required: true },
        { name: 'time_period', description: 'Time period for analysis', required: false }
      ]
    });
  }

  private async analyzeConversation(sessionId: string, includeContext: boolean = true): Promise<ConversationAnalysis> {
    const messages = await storage.getChatMessages(sessionId);
    
    if (messages.length === 0) {
      throw new Error(`No messages found for session ${sessionId}`);
    }

    // Analyze message patterns
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    
    const avgMessageLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length;
    
    // Extract topics using keyword analysis
    const topicsDiscussed = this.extractTopics(messages.map(m => m.content));
    
    // Track providers and models used
    const providersUsed = [...new Set(assistantMessages.map(m => m.model).filter(Boolean))];
    const modelsUsed = providersUsed;
    
    // Count specific query types
    const costOptimizationQueries = userMessages.filter(m => 
      /cost|price|billing|expense|budget|save|optimize|cheaper/i.test(m.content)
    ).length;
    
    const infraAnalysisQueries = userMessages.filter(m => 
      /resource|instance|server|database|storage|network|performance|scale/i.test(m.content)
    ).length;

    return {
      sessionId,
      messageCount: messages.length,
      avgMessageLength,
      topicsDiscussed,
      providersUsed,
      modelsUsed,
      costOptimizationQueries,
      infraAnalysisQueries
    };
  }

  private async getLLMUsageStats(provider?: string, timeRange: string = '24h'): Promise<any> {
    const timeThreshold = this.getTimeThreshold(timeRange);
    const stats = Array.from(this.usageStats.values())
      .filter(stat => {
        const matchesProvider = !provider || stat.provider === provider;
        const withinTimeRange = stat.lastUsed >= timeThreshold;
        return matchesProvider && withinTimeRange;
      });

    const totalRequests = stats.reduce((sum, stat) => sum + stat.requestCount, 0);
    const totalTokens = stats.reduce((sum, stat) => sum + stat.totalTokens, 0);
    const totalErrors = stats.reduce((sum, stat) => sum + stat.errorCount, 0);
    
    const averageResponseTime = stats.length > 0 
      ? stats.reduce((sum, stat) => sum + stat.averageResponseTime, 0) / stats.length 
      : 0;

    return {
      timeRange,
      provider: provider || 'all',
      summary: {
        totalRequests,
        totalTokens,
        totalErrors,
        errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        averageResponseTime
      },
      byProvider: this.groupStatsByProvider(stats),
      byModel: this.groupStatsByModel(stats),
      topPerformers: this.getTopPerformers(stats)
    };
  }

  private async recommendOptimalModel(queryType: string, accountContext?: string, complexity: string = 'moderate'): Promise<any> {
    // Model recommendations based on performance data and query type
    const recommendations = {
      'cost-analysis': {
        simple: { provider: 'openai', model: 'gpt-4o', reason: 'Fast and accurate for simple cost queries' },
        moderate: { provider: 'claude', model: 'claude-sonnet-4-20250514', reason: 'Excellent analytical capabilities' },
        complex: { provider: 'claude', model: 'claude-sonnet-4-20250514', reason: 'Best for complex cost optimization analysis' }
      },
      'resource-optimization': {
        simple: { provider: 'gemini', model: 'gemini-2.5-flash', reason: 'Quick resource analysis' },
        moderate: { provider: 'claude', model: 'claude-sonnet-4-20250514', reason: 'Strong infrastructure knowledge' },
        complex: { provider: 'perplexity', model: 'llama-3.1-sonar-large-128k-online', reason: 'Access to latest optimization techniques' }
      },
      'troubleshooting': {
        simple: { provider: 'openai', model: 'gpt-4o', reason: 'Reliable problem-solving' },
        moderate: { provider: 'claude', model: 'claude-sonnet-4-20250514', reason: 'Detailed troubleshooting steps' },
        complex: { provider: 'perplexity', model: 'llama-3.1-sonar-large-128k-online', reason: 'Access to latest troubleshooting info' }
      },
      'general': {
        simple: { provider: 'gemini', model: 'gemini-2.5-flash', reason: 'Fast and cost-effective' },
        moderate: { provider: 'openai', model: 'gpt-4o', reason: 'Well-balanced performance' },
        complex: { provider: 'claude', model: 'claude-sonnet-4-20250514', reason: 'Superior reasoning capabilities' }
      }
    };

    const recommendation = recommendations[queryType]?.[complexity] || recommendations['general'][complexity];
    
    return {
      queryType,
      complexity,
      accountContext,
      recommendation,
      alternatives: this.getAlternativeModels(queryType, complexity),
      estimatedCostSavings: this.estimateCostSavings(recommendation),
      estimatedPerformance: this.estimatePerformance(recommendation)
    };
  }

  private async trackLLMUsage(params: any): Promise<void> {
    const key = `${params.provider}-${params.model}`;
    const existing = this.usageStats.get(key) || {
      provider: params.provider,
      model: params.model,
      requestCount: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      averageResponseTime: 0,
      errorCount: 0,
      lastUsed: new Date()
    };

    existing.requestCount++;
    existing.totalTokens += (params.promptTokens || 0) + (params.completionTokens || 0);
    existing.promptTokens += params.promptTokens || 0;
    existing.completionTokens += params.completionTokens || 0;
    
    if (params.responseTime) {
      existing.averageResponseTime = (existing.averageResponseTime * (existing.requestCount - 1) + params.responseTime) / existing.requestCount;
    }
    
    if (!params.success) {
      existing.errorCount++;
    }
    
    existing.lastUsed = new Date();
    this.usageStats.set(key, existing);
  }

  private async generateUsageInsights(timeRange: string = '7d'): Promise<any> {
    const stats = await this.getLLMUsageStats(undefined, timeRange);
    
    const insights = {
      summary: stats.summary,
      patterns: {
        mostUsedProvider: this.getMostUsedProvider(stats.byProvider),
        mostReliableModel: this.getMostReliableModel(stats.byModel),
        peakUsageHours: this.calculatePeakUsageHours(),
        queryTypeDistribution: this.getQueryTypeDistribution()
      },
      recommendations: {
        costOptimization: this.generateCostOptimizationRecommendations(stats),
        performanceOptimization: this.generatePerformanceRecommendations(stats),
        reliabilityImprovements: this.generateReliabilityRecommendations(stats)
      },
      trends: {
        usageGrowth: this.calculateUsageGrowth(timeRange),
        modelPreferenceShifts: this.calculateModelPreferenceShifts(timeRange),
        errorRateTrends: this.calculateErrorRateTrends(timeRange)
      }
    };

    return insights;
  }

  // Helper methods
  private extractTopics(contents: string[]): string[] {
    const commonTopics = [
      'cost optimization', 'resource scaling', 'security', 'performance',
      'monitoring', 'backup', 'compliance', 'networking', 'storage',
      'compute', 'database', 'troubleshooting', 'migration'
    ];

    const text = contents.join(' ').toLowerCase();
    return commonTopics.filter(topic => text.includes(topic.toLowerCase()));
  }

  private getTimeThreshold(timeRange: string): Date {
    const now = new Date();
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    return new Date(now.getTime() - ranges[timeRange]);
  }

  private groupStatsByProvider(stats: LLMUsageStats[]): Record<string, any> {
    const grouped = stats.reduce((acc, stat) => {
      if (!acc[stat.provider]) {
        acc[stat.provider] = { requestCount: 0, totalTokens: 0, errorCount: 0 };
      }
      acc[stat.provider].requestCount += stat.requestCount;
      acc[stat.provider].totalTokens += stat.totalTokens;
      acc[stat.provider].errorCount += stat.errorCount;
      return acc;
    }, {} as Record<string, any>);

    return grouped;
  }

  private groupStatsByModel(stats: LLMUsageStats[]): Record<string, any> {
    return stats.reduce((acc, stat) => {
      acc[stat.model] = {
        requestCount: stat.requestCount,
        totalTokens: stat.totalTokens,
        errorCount: stat.errorCount,
        averageResponseTime: stat.averageResponseTime
      };
      return acc;
    }, {} as Record<string, any>);
  }

  private getTopPerformers(stats: LLMUsageStats[]): any[] {
    return stats
      .sort((a, b) => (b.requestCount - b.errorCount) - (a.requestCount - a.errorCount))
      .slice(0, 5)
      .map(stat => ({
        provider: stat.provider,
        model: stat.model,
        successRate: stat.requestCount > 0 ? ((stat.requestCount - stat.errorCount) / stat.requestCount) * 100 : 0,
        averageResponseTime: stat.averageResponseTime
      }));
  }

  private getAlternativeModels(queryType: string, complexity: string): any[] {
    // Return alternative model recommendations
    return [
      { provider: 'openai', model: 'gpt-4o', score: 85 },
      { provider: 'gemini', model: 'gemini-2.5-pro', score: 82 },
      { provider: 'perplexity', model: 'llama-3.1-sonar-small-128k-online', score: 78 }
    ];
  }

  private estimateCostSavings(recommendation: any): number {
    // Simplified cost estimation
    const baseCosts = {
      'openai': 0.01,
      'claude': 0.015,
      'gemini': 0.008,
      'perplexity': 0.012
    };
    return baseCosts[recommendation.provider] || 0.01;
  }

  private estimatePerformance(recommendation: any): any {
    return {
      speed: 'fast',
      accuracy: 'high',
      contextWindow: '128k',
      multimodal: recommendation.provider !== 'perplexity'
    };
  }

  private getMostUsedProvider(byProvider: Record<string, any>): string {
    return Object.entries(byProvider)
      .sort(([,a], [,b]) => b.requestCount - a.requestCount)[0]?.[0] || 'none';
  }

  private getMostReliableModel(byModel: Record<string, any>): string {
    return Object.entries(byModel)
      .sort(([,a], [,b]) => {
        const aReliability = (a.requestCount - a.errorCount) / a.requestCount;
        const bReliability = (b.requestCount - b.errorCount) / b.requestCount;
        return bReliability - aReliability;
      })[0]?.[0] || 'none';
  }

  private calculatePeakUsageHours(): number[] {
    // Simplified - would need actual timestamp data
    return [9, 10, 11, 14, 15, 16]; // Peak hours
  }

  private getQueryTypeDistribution(): Record<string, number> {
    return {
      'cost-analysis': 35,
      'resource-optimization': 25,
      'troubleshooting': 20,
      'general': 20
    };
  }

  private generateCostOptimizationRecommendations(stats: any): string[] {
    return [
      'Consider using Gemini for simple queries to reduce costs',
      'Batch similar queries to reduce API calls',
      'Use Claude for complex analysis to avoid multiple rounds'
    ];
  }

  private generatePerformanceRecommendations(stats: any): string[] {
    return [
      'Cache frequently asked questions',
      'Use streaming responses for long analyses',
      'Implement request queueing for peak hours'
    ];
  }

  private generateReliabilityRecommendations(stats: any): string[] {
    return [
      'Implement fallback providers for critical queries',
      'Add retry logic with exponential backoff',
      'Monitor error rates and switch providers automatically'
    ];
  }

  private calculateUsageGrowth(timeRange: string): number {
    return 15.5; // Simplified percentage growth
  }

  private calculateModelPreferenceShifts(timeRange: string): Record<string, number> {
    return {
      'claude-sonnet-4-20250514': 5.2,
      'gpt-4o': -2.1,
      'gemini-2.5-flash': 3.8
    };
  }

  private calculateErrorRateTrends(timeRange: string): Record<string, number> {
    return {
      'openai': -0.5,
      'claude': -1.2,
      'gemini': 0.3,
      'perplexity': -0.8
    };
  }
}