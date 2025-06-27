import { db } from "../db";
import { accounts, resources, costs, chatMessages } from "@shared/schema";
import { eq, and, sql, desc, asc, like, or, gte, lte, count, sum, avg, max, min } from "drizzle-orm";
import type { Account, Resource, Cost } from "@shared/schema";

interface TaskItem {
  id: string;
  description: string;
  query?: string;
  completed: boolean;
  result?: any;
}

interface ConversationMemory {
  sessionId: string;
  context: {
    selectedAccounts: number[];
    lastQuery: string;
    recentFindings: string[];
    pendingTasks: TaskItem[];
  };
  patterns: {
    userPreferences: string[];
    commonQueries: string[];
  };
}

class SqlAgent {
  private memories: Map<string, ConversationMemory> = new Map();

  /**
   * Main entry point for the SQL Agent
   * Works like Claude Code with memory, task planning, and user permission
   */
  async processQuery(
    sessionId: string, 
    query: string, 
    accountIds: number[]
  ): Promise<{
    response: string;
    suggestedTasks?: TaskItem[];
    needsPermission?: boolean;
    context?: any;
  }> {
    console.log(`🤖 SQL AGENT: Processing query for session ${sessionId}: "${query}"`);
    
    // Get or create conversation memory
    const memory = this.getOrCreateMemory(sessionId, accountIds);
    
    // Update context with current query
    memory.context.lastQuery = query;
    memory.context.selectedAccounts = accountIds;
    
    // Analyze the query and determine intent
    const intent = this.analyzeQueryIntent(query);
    
    // Generate task plan based on intent
    const tasks = await this.generateTaskPlan(query, intent, memory);
    
    // If tasks require user permission, return for approval
    if (tasks.some(t => this.requiresPermission(t))) {
      return {
        response: this.formatTaskApprovalRequest(query, tasks),
        suggestedTasks: tasks,
        needsPermission: true,
        context: memory.context
      };
    }
    
    // Execute approved tasks
    const results = await this.executeTasks(tasks, accountIds);
    
    // Update memory with findings
    memory.context.recentFindings.push(...results.map(r => r.summary));
    if (memory.context.recentFindings.length > 10) {
      memory.context.recentFindings = memory.context.recentFindings.slice(-10);
    }
    
    // Generate response with follow-up suggestions
    const response = await this.generateComprehensiveResponse(query, results, memory);
    
    return {
      response,
      context: memory.context
    };
  }

  /**
   * Execute pre-approved tasks from user permission
   */
  async executePendingTasks(sessionId: string, approvedTaskIds: string[]): Promise<string> {
    const memory = this.memories.get(sessionId);
    if (!memory) throw new Error("Session memory not found");
    
    const tasksToExecute = memory.context.pendingTasks.filter(t => approvedTaskIds.includes(t.id));
    const results = await this.executeTasks(tasksToExecute, memory.context.selectedAccounts);
    
    // Mark tasks as completed
    tasksToExecute.forEach(task => task.completed = true);
    memory.context.pendingTasks = memory.context.pendingTasks.filter(t => !approvedTaskIds.includes(t.id));
    
    return this.formatTaskResults(results);
  }

  private getOrCreateMemory(sessionId: string, accountIds: number[]): ConversationMemory {
    if (!this.memories.has(sessionId)) {
      this.memories.set(sessionId, {
        sessionId,
        context: {
          selectedAccounts: accountIds,
          lastQuery: "",
          recentFindings: [],
          pendingTasks: []
        },
        patterns: {
          userPreferences: [],
          commonQueries: []
        }
      });
    }
    return this.memories.get(sessionId)!;
  }

  private analyzeQueryIntent(query: string): {
    type: 'cost_analysis' | 'resource_inquiry' | 'optimization' | 'comparison' | 'troubleshooting' | 'general';
    entities: string[];
    timeframe?: string;
    metrics: string[];
  } {
    const lowerQuery = query.toLowerCase();
    
    // Extract entities (instance IDs, resource types, etc.)
    const entities = [];
    const instancePattern = /i-[a-z0-9]+/g;
    const volumePattern = /vol-[a-z0-9]+/g;
    entities.push(...(lowerQuery.match(instancePattern) || []));
    entities.push(...(lowerQuery.match(volumePattern) || []));
    
    // Determine intent type
    let type: any = 'general';
    if (lowerQuery.includes('cost') || lowerQuery.includes('spending') || lowerQuery.includes('bill')) {
      type = 'cost_analysis';
    } else if (lowerQuery.includes('optimize') || lowerQuery.includes('savings')) {
      type = 'optimization';
    } else if (lowerQuery.includes('compare') || lowerQuery.includes('vs') || lowerQuery.includes('difference')) {
      type = 'comparison';
    } else if (entities.length > 0 || lowerQuery.includes('resource') || lowerQuery.includes('instance')) {
      type = 'resource_inquiry';
    }
    
    // Extract metrics
    const metrics = [];
    if (lowerQuery.includes('cost')) metrics.push('cost');
    if (lowerQuery.includes('performance')) metrics.push('performance');
    if (lowerQuery.includes('utilization')) metrics.push('utilization');
    if (lowerQuery.includes('storage')) metrics.push('storage');
    
    return { type, entities, metrics };
  }

  private async generateTaskPlan(query: string, intent: any, memory: ConversationMemory): Promise<TaskItem[]> {
    const tasks: TaskItem[] = [];
    
    switch (intent.type) {
      case 'cost_analysis':
        tasks.push({
          id: 'cost_overview',
          description: 'Analyze current cost breakdown by service and region',
          query: 'SELECT_COSTS_BY_SERVICE_AND_REGION',
          completed: false
        });
        
        if (memory.context.recentFindings.length === 0) {
          tasks.push({
            id: 'cost_trends',
            description: 'Analyze cost trends over the last 30 days',
            query: 'SELECT_COST_TRENDS',
            completed: false
          });
        }
        break;
        
      case 'resource_inquiry':
        if (intent.entities.length > 0) {
          tasks.push({
            id: 'specific_resource',
            description: `Get detailed information about specific resources: ${intent.entities.join(', ')}`,
            query: `SELECT_SPECIFIC_RESOURCES`,
            completed: false
          });
        } else {
          tasks.push({
            id: 'resource_overview',
            description: 'Get overview of all resources across accounts',
            query: 'SELECT_RESOURCE_OVERVIEW',
            completed: false
          });
        }
        break;
        
      case 'optimization':
        tasks.push({
          id: 'find_optimization',
          description: 'Identify optimization opportunities (unattached volumes, stopped instances)',
          query: 'SELECT_OPTIMIZATION_OPPORTUNITIES',
          completed: false
        });
        
        tasks.push({
          id: 'cost_savings',
          description: 'Calculate potential cost savings',
          query: 'CALCULATE_POTENTIAL_SAVINGS',
          completed: false
        });
        break;
    }
    
    return tasks;
  }

  private requiresPermission(task: TaskItem): boolean {
    // Tasks that require permission (like making changes or accessing sensitive data)
    const sensitiveActions = ['MODIFY_', 'DELETE_', 'UPDATE_', 'TERMINATE_'];
    return sensitiveActions.some(action => task.query?.includes(action));
  }

  private formatTaskApprovalRequest(query: string, tasks: TaskItem[]): string {
    return `I understand you want: "${query}"

To provide you with comprehensive insights, I'd like to perform these tasks:

${tasks.map((task, i) => `${i + 1}. ${task.description}`).join('\n')}

**Would you like me to proceed with these tasks?** 
- Say "yes" or "proceed" to approve all tasks
- Or specify which tasks you'd like me to focus on

This approach ensures I give you exactly the information you need while being transparent about what I'm analyzing.`;
  }

  private async executeTasks(tasks: TaskItem[], accountIds: number[]): Promise<any[]> {
    const results = [];
    
    for (const task of tasks) {
      try {
        console.log(`🔄 Executing task: ${task.description}`);
        
        let result;
        switch (task.query) {
          case 'SELECT_COSTS_BY_SERVICE_AND_REGION':
            result = await this.getCostsByServiceAndRegion(accountIds);
            break;
          case 'SELECT_COST_TRENDS':
            result = await this.getCostTrends(accountIds);
            break;
          case 'SELECT_SPECIFIC_RESOURCES':
            result = await this.getSpecificResources(accountIds, task.description);
            break;
          case 'SELECT_RESOURCE_OVERVIEW':
            result = await this.getResourceOverview(accountIds);
            break;
          case 'SELECT_OPTIMIZATION_OPPORTUNITIES':
            result = await this.getOptimizationOpportunities(accountIds);
            break;
          case 'CALCULATE_POTENTIAL_SAVINGS':
            result = await this.calculatePotentialSavings(accountIds);
            break;
          default:
            result = { summary: "Task completed", data: {} };
        }
        
        task.result = result;
        task.completed = true;
        results.push(result);
        
      } catch (error) {
        console.error(`❌ Task failed: ${task.description}`, error);
        results.push({ 
          summary: `Task failed: ${task.description}`, 
          error: error.message,
          data: null 
        });
      }
    }
    
    return results;
  }

  // SQL Query Methods
  private async getCostsByServiceAndRegion(accountIds: number[]) {
    const costData = await db
      .select({
        accountId: costs.accountId,
        service: costs.service,
        amount: costs.amount,
        period: costs.period,
        date: costs.date
      })
      .from(costs)
      .where(accountIds.length ? sql`${costs.accountId} = ANY(${accountIds})` : sql`1=1`)
      .orderBy(desc(costs.date));

    const summary = `Found ${costData.length} cost records across ${accountIds.length} accounts`;
    return { summary, data: costData };
  }

  private async getCostTrends(accountIds: number[]) {
    // Get costs from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const trendData = await db
      .select({
        date: costs.date,
        totalAmount: sum(costs.amount),
        service: costs.service
      })
      .from(costs)
      .where(and(
        accountIds.length ? sql`${costs.accountId} = ANY(${accountIds})` : sql`1=1`,
        gte(costs.date, thirtyDaysAgo)
      ))
      .groupBy(costs.date, costs.service)
      .orderBy(desc(costs.date));

    const summary = `Analyzed cost trends for the last 30 days`;
    return { summary, data: trendData };
  }

  private async getSpecificResources(accountIds: number[], description: string) {
    // Extract resource IDs from description
    const instanceIds = description.match(/i-[a-z0-9]+/g) || [];
    const volumeIds = description.match(/vol-[a-z0-9]+/g) || [];
    
    let resourceData = [];
    
    if (instanceIds.length > 0 || volumeIds.length > 0) {
      resourceData = await db
        .select()
        .from(resources)
        .where(and(
          accountIds.length ? sql`${resources.accountId} = ANY(${accountIds})` : sql`1=1`,
          or(
            instanceIds.length ? sql`${resources.resourceId} = ANY(${instanceIds})` : sql`1=0`,
            volumeIds.length ? sql`${resources.resourceId} = ANY(${volumeIds})` : sql`1=0`
          )
        ));
    }
    
    const summary = `Found ${resourceData.length} specific resources matching your query`;
    return { summary, data: resourceData };
  }

  private async getResourceOverview(accountIds: number[]) {
    const resourceOverview = await db
      .select({
        type: resources.type,
        provider: resources.provider,
        status: resources.status,
        count: count(),
        totalCost: sum(resources.monthlyCost)
      })
      .from(resources)
      .where(accountIds.length ? sql`${resources.accountId} = ANY(${accountIds})` : sql`1=1`)
      .groupBy(resources.type, resources.provider, resources.status);

    const summary = `Resource overview across ${accountIds.length} accounts`;
    return { summary, data: resourceOverview };
  }

  private async getOptimizationOpportunities(accountIds: number[]) {
    // Find unattached volumes
    const unattachedVolumes = await db
      .select()
      .from(resources)
      .where(and(
        accountIds.length ? sql`${resources.accountId} = ANY(${accountIds})` : sql`1=1`,
        eq(resources.type, 'ebs-volume'),
        eq(resources.status, 'available')
      ));

    // Find stopped instances
    const stoppedInstances = await db
      .select()
      .from(resources)
      .where(and(
        accountIds.length ? sql`${resources.accountId} = ANY(${accountIds})` : sql`1=1`,
        eq(resources.type, 'ec2-instance'),
        eq(resources.status, 'stopped')
      ));

    const summary = `Found ${unattachedVolumes.length} unattached volumes and ${stoppedInstances.length} stopped instances`;
    return { 
      summary, 
      data: { 
        unattachedVolumes: unattachedVolumes.length,
        stoppedInstances: stoppedInstances.length,
        details: { unattachedVolumes, stoppedInstances }
      }
    };
  }

  private async calculatePotentialSavings(accountIds: number[]) {
    // Calculate potential savings from optimization opportunities
    const unattachedVolumesCost = await db
      .select({
        totalCost: sum(resources.monthlyCost)
      })
      .from(resources)
      .where(and(
        accountIds.length ? sql`${resources.accountId} = ANY(${accountIds})` : sql`1=1`,
        eq(resources.type, 'ebs-volume'),
        eq(resources.status, 'available')
      ));

    const stoppedInstancesCost = await db
      .select({
        totalCost: sum(resources.monthlyCost)
      })
      .from(resources)
      .where(and(
        accountIds.length ? sql`${resources.accountId} = ANY(${accountIds})` : sql`1=1`,
        eq(resources.type, 'ec2-instance'),
        eq(resources.status, 'stopped')
      ));

    const volumeSavings = Number(unattachedVolumesCost[0]?.totalCost || 0);
    const instanceSavings = Number(stoppedInstancesCost[0]?.totalCost || 0) * 0.7; // 70% savings on stopped instances
    const totalSavings = volumeSavings + instanceSavings;

    const summary = `Potential monthly savings: $${totalSavings.toFixed(2)}`;
    return { 
      summary, 
      data: { 
        volumeSavings, 
        instanceSavings, 
        totalSavings,
        breakdown: {
          unattachedVolumes: volumeSavings,
          stoppedInstances: instanceSavings
        }
      }
    };
  }

  private async generateComprehensiveResponse(query: string, results: any[], memory: ConversationMemory): Promise<string> {
    const findings = results.map(r => r.summary).join('\n');
    
    // Generate contextual follow-up suggestions based on findings
    const followUps = this.generateFollowUpSuggestions(results, memory);
    
    return `Based on your query: "${query}"

## Key Findings:
${findings}

## Next Steps I Can Help With:
${followUps.map((suggestion, i) => `${i + 1}. ${suggestion}`).join('\n')}

Feel free to ask me to dive deeper into any of these areas, or ask about something specific you'd like to investigate further.`;
  }

  private generateFollowUpSuggestions(results: any[], memory: ConversationMemory): string[] {
    const suggestions = [];
    
    // Analyze results to suggest relevant follow-ups
    const hasOptimization = results.some(r => r.data?.unattachedVolumes || r.data?.stoppedInstances);
    const hasCostData = results.some(r => r.data?.length > 0 && r.summary.includes('cost'));
    
    if (hasOptimization) {
      suggestions.push("Show me detailed cost breakdown for the optimization opportunities");
      suggestions.push("Help me create a plan to implement these optimizations");
    }
    
    if (hasCostData) {
      suggestions.push("Compare costs across different regions");
      suggestions.push("Analyze cost trends over time");
    }
    
    suggestions.push("Find resources that might be over-provisioned");
    suggestions.push("Show me security-related findings");
    
    return suggestions.slice(0, 4); // Limit to 4 suggestions
  }

  private formatTaskResults(results: any[]): string {
    return results.map(result => `✅ ${result.summary}`).join('\n\n');
  }
}

export const sqlAgent = new SqlAgent();