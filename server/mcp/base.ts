import { EventEmitter } from 'events';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  handler: (params: any) => Promise<any>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface ToolUsage {
  id: string;
  toolName: string;
  timestamp: Date;
  params: any;
  result: any;
  executionTime: number;
  success: boolean;
  error?: string;
  context?: {
    accountId?: number;
    provider?: string;
    llmModel?: string;
  };
}

export abstract class MCPServer extends EventEmitter {
  protected tools: Map<string, MCPTool> = new Map();
  protected resources: Map<string, MCPResource> = new Map();
  protected prompts: Map<string, MCPPrompt> = new Map();
  protected toolUsage: ToolUsage[] = [];

  constructor(public name: string, public version: string = '1.0.0') {
    super();
    this.initializeTools();
    this.initializeResources();
    this.initializePrompts();
  }

  abstract initializeTools(): void;
  abstract initializeResources(): void;
  abstract initializePrompts(): void;

  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
  }

  registerPrompt(prompt: MCPPrompt): void {
    this.prompts.set(prompt.name, prompt);
  }

  async executeTool(name: string, params: any, context?: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    const startTime = Date.now();
    const usageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let result: any;
    let error: string | undefined;
    let success = true;

    try {
      result = await tool.handler(params);
      this.emit('toolExecuted', { name, params, result, context });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      success = false;
      result = null;
      this.emit('toolError', { name, params, error, context });
    }

    const executionTime = Date.now() - startTime;
    const usage: ToolUsage = {
      id: usageId,
      toolName: name,
      timestamp: new Date(),
      params,
      result,
      executionTime,
      success,
      error,
      context,
    };

    this.toolUsage.push(usage);
    this.emit('toolUsageRecorded', usage);

    if (!success) {
      throw new Error(error);
    }

    return result;
  }

  getToolUsageStats(): {
    totalUsage: number;
    successRate: number;
    averageExecutionTime: number;
    mostUsedTools: Array<{ name: string; count: number }>;
    recentErrors: Array<{ toolName: string; error: string; timestamp: Date }>;
  } {
    const total = this.toolUsage.length;
    const successful = this.toolUsage.filter(u => u.success).length;
    const successRate = total > 0 ? (successful / total) * 100 : 0;
    
    const avgExecutionTime = total > 0 
      ? this.toolUsage.reduce((sum, u) => sum + u.executionTime, 0) / total 
      : 0;

    const toolCounts = new Map<string, number>();
    this.toolUsage.forEach(usage => {
      toolCounts.set(usage.toolName, (toolCounts.get(usage.toolName) || 0) + 1);
    });

    const mostUsedTools = Array.from(toolCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const recentErrors = this.toolUsage
      .filter(u => !u.success && u.error)
      .slice(-10)
      .map(u => ({
        toolName: u.toolName,
        error: u.error!,
        timestamp: u.timestamp,
      }));

    return {
      totalUsage: total,
      successRate,
      averageExecutionTime: avgExecutionTime,
      mostUsedTools,
      recentErrors,
    };
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values());
  }

  getRecentToolUsage(limit: number = 50): ToolUsage[] {
    return this.toolUsage
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
}