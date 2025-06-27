import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { db } from "../db";
import { accounts, resources, costs, chatMessages } from "@shared/schema";
import { eq, and, sql, desc, asc, like, or, gte, lte, count, sum, avg, max, min, inArray } from "drizzle-orm";

// State interface for LangGraph
const GraphState = Annotation.Root({
  messages: Annotation<Array<HumanMessage | AIMessage | SystemMessage>>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  query: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  }),
  accountIds: Annotation<number[]>({
    reducer: (x, y) => y ?? x ?? [],
    default: () => [],
  }),
  sessionId: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  }),
  currentAccount: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "",
    default: () => "",
  }),
  analysisResult: Annotation<any>({
    reducer: (x, y) => y ?? x ?? null,
    default: () => null,
  }),
  visualizations: Annotation<any[]>({
    reducer: (x, y) => y ?? x ?? [],
    default: () => [],
  }),
  context: Annotation<any>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
});

interface VisualizationData {
  type: 'bar' | 'pie' | 'line' | 'table' | 'metric';
  title: string;
  data: any;
  description?: string;
}

class LangGraphOrchestrator {
  private graph: StateGraph<typeof GraphState.State>;

  constructor() {
    this.graph = new StateGraph(GraphState)
      .addNode("analyze_query", this.analyzeQuery.bind(this))
      .addNode("fetch_data", this.fetchData.bind(this))
      .addNode("generate_visualizations", this.generateVisualizations.bind(this))
      .addNode("format_response", this.formatResponse.bind(this))
      .addEdge(START, "analyze_query")
      .addEdge("analyze_query", "fetch_data")
      .addEdge("fetch_data", "generate_visualizations")
      .addEdge("generate_visualizations", "format_response")
      .addEdge("format_response", END);
  }

  async processQuery(sessionId: string, query: string, accountIds: number[], currentAccount: string) {
    console.log(`🎯 LANGGRAPH: Processing query "${query}" for accounts ${accountIds} (current: ${currentAccount})`);
    
    // Check if this is a permission response first
    if (this.isPermissionResponse(query)) {
      return await this.handlePermissionResponse(sessionId, query, accountIds, currentAccount);
    }
    
    const compiled = this.graph.compile();
    
    const result = await compiled.invoke({
      query,
      accountIds,
      sessionId,
      currentAccount,
      messages: [new HumanMessage(query)],
    });

    return {
      response: result.analysisResult?.response || "Analysis completed",
      visualizations: result.visualizations || [],
      context: result.context || {},
      needsPermission: result.analysisResult?.needsPermission || false,
      suggestedTasks: result.analysisResult?.suggestedTasks || []
    };
  }

  private isPermissionResponse(query: string): boolean {
    const lowerQuery = query.toLowerCase().trim();
    const yesPatterns = ['yes', 'proceed', 'go ahead', 'continue', 'do it', 'sure', 'ok', 'okay', 'y'];
    const noPatterns = ['no', 'stop', 'cancel', 'abort', 'don\'t', 'skip', 'n'];
    
    return yesPatterns.includes(lowerQuery) || noPatterns.includes(lowerQuery);
  }

  private async handlePermissionResponse(sessionId: string, query: string, accountIds: number[], currentAccount: string) {
    const lowerQuery = query.toLowerCase().trim();
    const isApproval = ['yes', 'proceed', 'go ahead', 'continue', 'do it', 'sure', 'ok', 'okay', 'y'].includes(lowerQuery);
    
    if (isApproval) {
      console.log(`✅ PERMISSION GRANTED: Executing pending tasks for session ${sessionId}`);
      
      // Execute the pending analysis tasks
      const compiled = this.graph.compile();
      const result = await compiled.invoke({
        query: "execute_pending_analysis", // Special query to trigger full analysis
        accountIds,
        sessionId,
        currentAccount,
        messages: [new HumanMessage("Execute approved analysis")],
      });

      return {
        response: result.analysisResult?.response || "Analysis completed",
        visualizations: result.visualizations || [],
        context: result.context || {},
        needsPermission: false
      };
    } else {
      console.log(`❌ PERMISSION DENIED: User declined analysis for session ${sessionId}`);
      return {
        response: "Understood. Let me know if you'd like me to help with something else regarding your infrastructure.",
        visualizations: [],
        context: {},
        needsPermission: false
      };
    }
  }

  private async analyzeQuery(state: typeof GraphState.State) {
    console.log("🔍 LANGGRAPH: Analyzing query intent and scope");
    
    const { query, accountIds, currentAccount } = state;
    
    // Analyze query for intent and entities
    const intent = this.extractIntent(query);
    const entities = this.extractEntities(query);
    
    // Determine if this requires permission
    const requiresPermission = this.shouldAskPermission(query, intent);
    
    // Determine scope based on current account context
    let targetAccountIds = accountIds;
    if (currentAccount !== "All Accounts") {
      // User is in a specific account context, focus on that account
      const allAccounts = await db.select().from(accounts);
      const currentAccountData = allAccounts.find(acc => acc.name === currentAccount);
      if (currentAccountData) {
        targetAccountIds = [currentAccountData.id];
        console.log(`🎯 CONTEXT: Focusing on account "${currentAccount}" (ID: ${currentAccountData.id})`);
      }
    }
    
    return {
      ...state,
      accountIds: targetAccountIds,
      context: {
        intent,
        entities,
        scope: currentAccount === "All Accounts" ? "multi-account" : "single-account",
        focusAccount: currentAccount,
        requiresPermission
      }
    };
  }

  private shouldAskPermission(query: string, intent: string[]): boolean {
    // Don't ask permission for approval responses
    if (this.isPermissionResponse(query)) {
      return false;
    }

    // Ask permission for infrastructure analysis queries
    const needsPermissionPatterns = [
      'stopped', 'instances', 'costs', 'optimization', 'resources', 
      'volumes', 'buckets', 'security', 'performance', 'usage',
      'running', 'ec2', 's3', 'rds', 'lambda', 'unattached'
    ];
    
    const lowerQuery = query.toLowerCase();
    const needsPermission = needsPermissionPatterns.some(pattern => lowerQuery.includes(pattern));
    
    console.log(`🔒 PERMISSION CHECK: Query "${query}" ${needsPermission ? 'REQUIRES' : 'DOES NOT REQUIRE'} permission`);
    
    return needsPermission;
  }

  private formatPermissionRequest(query: string, context: any, currentAccount: string) {
    console.log("🔒 FORMATTING PERMISSION REQUEST");
    
    const { intent, scope } = context;
    
    // Detect what kind of analysis is being requested
    let analysisType = "infrastructure analysis";
    let tasksToPerform = [];
    
    if (intent.includes('stopped') || intent.includes('instances')) {
      analysisType = "stopped instances analysis";
      tasksToPerform = [
        "Scan all EC2 instances to identify stopped instances",
        "Calculate monthly storage costs for stopped instances",
        "Analyze regional and account distribution",
        "Generate cost optimization recommendations",
        "Create detailed tables and visualizations"
      ];
    } else if (intent.includes('costs') || intent.includes('spending')) {
      analysisType = "cost analysis";
      tasksToPerform = [
        "Query cost data across all selected accounts",
        "Calculate cost trends and patterns",
        "Identify top spending services and regions",
        "Generate cost breakdown visualizations",
        "Provide optimization insights"
      ];
    } else if (intent.includes('optimization')) {
      analysisType = "optimization analysis";
      tasksToPerform = [
        "Scan for unattached EBS volumes",
        "Identify stopped instances",
        "Calculate potential cost savings",
        "Analyze resource utilization patterns",
        "Generate actionable recommendations"
      ];
    } else {
      // Generic infrastructure analysis
      tasksToPerform = [
        "Analyze resource inventory and costs",
        "Generate comprehensive visualizations",
        "Provide insights and recommendations",
        "Create detailed data tables"
      ];
    }

    const accountScope = currentAccount === "All Accounts" ? 
      "all your AWS accounts" : 
      `your **${currentAccount}** account`;

    const response = `I understand you want to analyze **${query}**.

To provide you with comprehensive insights, I need to perform a **${analysisType}** across ${accountScope}. This will involve:

${tasksToPerform.map((task, i) => `${i + 1}. ${task}`).join('\n')}

**Would you like me to proceed with this analysis?**

Simply respond with:
- **"Yes"** or **"Proceed"** to start the analysis
- **"No"** if you'd prefer to skip this analysis

This approach ensures I give you exactly the information you need while being transparent about what data I'm analyzing.`;

    return {
      ...context,
      analysisResult: { 
        response,
        needsPermission: true,
        suggestedTasks: tasksToPerform
      }
    };
  }

  private async fetchData(state: typeof GraphState.State) {
    console.log("📊 LANGGRAPH: Fetching relevant data based on analysis");
    
    const { accountIds, context } = state;
    
    // Fetch accounts data
    const accountsData = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, accountIds));

    // Fetch resources data based on intent
    let resourcesData = [];
    let costsData = [];
    
    if (context.intent.includes('stopped') || context.intent.includes('instances')) {
      resourcesData = await db
        .select()
        .from(resources)
        .where(and(
          inArray(resources.accountId, accountIds),
          eq(resources.type, 'ec2-instance')
        ));
      
      // Get costs for these resources
      costsData = await db
        .select()
        .from(costs)
        .where(inArray(costs.accountId, accountIds));
    } else {
      // Fetch all resources and costs for broader analysis
      resourcesData = await db
        .select()
        .from(resources)
        .where(inArray(resources.accountId, accountIds));
        
      costsData = await db
        .select()
        .from(costs)
        .where(inArray(costs.accountId, accountIds));
    }

    return {
      ...state,
      context: {
        ...context,
        accounts: accountsData,
        resources: resourcesData,
        costs: costsData
      }
    };
  }

  private async generateVisualizations(state: typeof GraphState.State) {
    console.log("📈 LANGGRAPH: Generating rich visualizations");
    
    const { context } = state;
    const { resources, accounts, intent } = context;
    
    const visualizations: VisualizationData[] = [];
    
    if (intent.includes('stopped') || intent.includes('instances')) {
      const stoppedInstances = resources.filter(r => 
        r.type === 'ec2-instance' && r.status === 'stopped'
      );
      
      // Overview metric
      visualizations.push({
        type: 'metric',
        title: 'Stopped Instances',
        data: {
          value: stoppedInstances.length,
          label: 'Total Stopped EC2 Instances',
          trend: 'neutral'
        }
      });

      // Distribution by region
      const regionDistribution = this.groupBy(stoppedInstances, 'region');
      visualizations.push({
        type: 'bar',
        title: '📍 Distribution by Region',
        data: {
          labels: Object.keys(regionDistribution),
          datasets: [{
            label: 'Stopped Instances',
            data: Object.values(regionDistribution).map((items: any) => items.length),
            backgroundColor: '#f59e0b'
          }]
        }
      });

      // Distribution by account
      const accountDistribution = this.groupBy(stoppedInstances, 'accountId');
      const accountData = Object.entries(accountDistribution).map(([accountId, instances]) => {
        const account = accounts.find(a => a.id === parseInt(accountId));
        return {
          name: account?.name || `Account ${accountId}`,
          value: (instances as any[]).length
        };
      });
      
      visualizations.push({
        type: 'pie',
        title: '🏢 Distribution by Account',
        data: {
          datasets: [{
            data: accountData.map(item => item.value),
            backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6']
          }],
          labels: accountData.map(item => item.name)
        }
      });

      // Detailed table
      const tableData = stoppedInstances.map(instance => {
        const account = accounts.find(a => a.id === instance.accountId);
        return {
          'Instance ID': instance.resourceId,
          'Name': instance.name,
          'Type': instance.metadata?.instanceType || 'Unknown',
          'Region': instance.region,
          'Account': account?.name || 'Unknown',
          'Monthly Cost': instance.monthlyCost ? `$${parseFloat(instance.monthlyCost).toFixed(2)}` : 'N/A'
        };
      });

      visualizations.push({
        type: 'table',
        title: '📋 Detailed Instance Information',
        data: {
          headers: ['Instance ID', 'Name', 'Type', 'Region', 'Account', 'Monthly Cost'],
          rows: tableData
        },
        description: 'Complete list of stopped EC2 instances with their details'
      });
    }

    return {
      ...state,
      visualizations
    };
  }

  private async formatResponse(state: typeof GraphState.State) {
    console.log("✨ LANGGRAPH: Formatting Claude-like response");
    
    const { query, context, visualizations, currentAccount } = state;
    const { resources, accounts, requiresPermission } = context;
    
    // If permission is required, ask for it first
    if (requiresPermission && query !== "execute_pending_analysis") {
      return this.formatPermissionRequest(query, context, currentAccount);
    }
    
    if (context.intent.includes('stopped') || context.intent.includes('instances')) {
      const stoppedInstances = resources.filter(r => 
        r.type === 'ec2-instance' && r.status === 'stopped'
      );
      
      // Generate region breakdown
      const regionStats = this.groupBy(stoppedInstances, 'region');
      const regionList = Object.entries(regionStats)
        .sort(([,a], [,b]) => (b as any[]).length - (a as any[]).length)
        .map(([region, instances]) => `- **${region}**: ${(instances as any[]).length} instances`)
        .join('\n');

      // Generate account breakdown
      const accountStats = this.groupBy(stoppedInstances, 'accountId');
      const accountList = Object.entries(accountStats)
        .sort(([,a], [,b]) => (b as any[]).length - (a as any[]).length)
        .map(([accountId, instances]) => {
          const account = accounts.find(a => a.id === parseInt(accountId));
          return `- **${account?.name || 'Unknown'}**: ${(instances as any[]).length} instances`;
        })
        .join('\n');

      // Calculate cost impact
      const totalMonthlyCost = stoppedInstances
        .reduce((sum, instance) => sum + parseFloat(instance.monthlyCost || '0'), 0);

      // Generate notable patterns and insights
      const patterns = this.analyzePatterns(stoppedInstances, accounts);
      const insights = this.generateInsights(stoppedInstances);
      const followUps = this.generateFollowUpQuestions(stoppedInstances, currentAccount);

      // Create detailed table view if instances exist
      let detailedTable = '';
      if (stoppedInstances.length > 0) {
        detailedTable = `
## 📋 Instance Details
${stoppedInstances.length > 5 ? 
  `Showing top ${Math.min(5, stoppedInstances.length)} instances by cost:` : 
  'All stopped instances:'
}

| Instance Name | Instance ID | Type | Region | Monthly Cost |
|---------------|-------------|------|---------|---------------|
${stoppedInstances
  .sort((a, b) => parseFloat(b.monthlyCost || '0') - parseFloat(a.monthlyCost || '0'))
  .slice(0, 5)
  .map(instance => {
    const cost = instance.monthlyCost ? `$${parseFloat(instance.monthlyCost).toFixed(2)}` : 'N/A';
    const instanceType = instance.metadata?.instanceType || 'Unknown';
    return `| **${instance.name}** | ${instance.resourceId} | ${instanceType} | ${instance.region} | ${cost} |`;
  })
  .join('\n')}
`;
      }

      const response = `# 📊 Stopped Instances${currentAccount !== "All Accounts" ? ` - ${currentAccount}` : ''}

${currentAccount === "All Accounts" ? 
  `You have **${stoppedInstances.length} stopped EC2 instances** across your AWS infrastructure:` :
  `You have **${stoppedInstances.length} stopped EC2 instances** in **${currentAccount}**:`
}

${stoppedInstances.length > 0 ? `
## 📍 ${regionList.split('\n').length > 1 ? 'Regional Distribution' : 'All instances are located in **' + Object.keys(this.groupBy(stoppedInstances, 'region'))[0] + '**'}
${regionList}

${detailedTable}

## 💰 Cost Summary
${totalMonthlyCost > 0 ? 
  `- **Total monthly cost**: $${totalMonthlyCost.toFixed(2)}
${insights.costBreakdown}` :
  '- Cost information is being calculated...'
}

## 🔍 Key Insights
${insights.keyFindings.join('\n')}

${patterns.length > 0 ? `
## 🔍 Notable Patterns
${patterns.join('\n')}
` : ''}

## 📈 What You Can Do Next

${followUps.join('\n')}

---

💡 **Quick Actions:**
- **Terminate unused instances** to eliminate storage costs
- **Start instances** that are needed for current workloads  
- **Right-size instances** before restarting to optimize costs
- **Set up automated scheduling** to stop/start instances based on usage patterns` : 
  'No stopped instances found in the selected scope.'
}`;

      return {
        ...state,
        analysisResult: { response }
      };
    }

    // Default response for other queries
    return {
      ...state,
      analysisResult: { 
        response: "I'm ready to analyze your infrastructure. Please ask about costs, resources, or optimization opportunities." 
      }
    };
  }

  private extractIntent(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    const intents = [];
    
    if (lowerQuery.includes('stopped')) intents.push('stopped');
    if (lowerQuery.includes('instances') || lowerQuery.includes('ec2')) intents.push('instances');
    if (lowerQuery.includes('cost') || lowerQuery.includes('spending')) intents.push('cost');
    if (lowerQuery.includes('optimize') || lowerQuery.includes('optimization')) intents.push('optimization');
    if (lowerQuery.includes('region')) intents.push('region');
    if (lowerQuery.includes('account')) intents.push('account');
    
    return intents;
  }

  private extractEntities(query: string): string[] {
    const entities = [];
    
    // Extract instance IDs
    const instanceIds = query.match(/i-[a-z0-9]+/g) || [];
    entities.push(...instanceIds);
    
    // Extract volume IDs  
    const volumeIds = query.match(/vol-[a-z0-9]+/g) || [];
    entities.push(...volumeIds);
    
    return entities;
  }

  private groupBy(array: any[], key: string): Record<string, any[]> {
    return array.reduce((groups, item) => {
      const group = item[key] || 'unknown';
      groups[group] = groups[group] || [];
      groups[group].push(item);
      return groups;
    }, {});
  }

  private generateInsights(instances: any[]): { keyFindings: string[], costBreakdown: string } {
    const keyFindings = [];
    let costBreakdown = '';
    
    if (instances.length === 0) {
      return { keyFindings: ['- No stopped instances found'], costBreakdown: '' };
    }

    // Sort instances by cost
    const sortedByCost = instances
      .filter(i => i.monthlyCost && parseFloat(i.monthlyCost) > 0)
      .sort((a, b) => parseFloat(b.monthlyCost) - parseFloat(a.monthlyCost));

    if (sortedByCost.length > 0) {
      const highest = sortedByCost[0];
      const lowest = sortedByCost[sortedByCost.length - 1];
      
      keyFindings.push(`- **Largest cost**: ${highest.name} (${highest.metadata?.instanceType || 'Unknown'}) at $${parseFloat(highest.monthlyCost).toFixed(2)}/month`);
      
      if (sortedByCost.length > 1) {
        keyFindings.push(`- **Smallest cost**: ${lowest.name} (${lowest.metadata?.instanceType || 'Unknown'}) at $${parseFloat(lowest.monthlyCost).toFixed(2)}/month`);
      }

      // Cost concentration analysis
      const totalCost = sortedByCost.reduce((sum, i) => sum + parseFloat(i.monthlyCost), 0);
      const highestPercentage = (parseFloat(highest.monthlyCost) / totalCost) * 100;
      
      if (highestPercentage > 50) {
        keyFindings.push(`- The **${highest.name}** instance represents **${highestPercentage.toFixed(0)}%** of total stopped instance costs`);
      }

      costBreakdown = `- **Average cost per instance**: $${(totalCost / sortedByCost.length).toFixed(2)}/month`;
    }

    // Instance type analysis
    const instanceTypes = [...new Set(instances.map(i => i.metadata?.instanceType).filter(Boolean))];
    if (instanceTypes.length > 1) {
      keyFindings.push(`- Mix of **${instanceTypes.length} different instance types** from nano to xlarge`);
    }

    // Regional concentration
    const regions = [...new Set(instances.map(i => i.region).filter(Boolean))];
    if (regions.length === 1) {
      keyFindings.push(`- All instances are in the same region (**${regions[0]}**)`);
    } else {
      keyFindings.push(`- Instances distributed across **${regions.length} regions**`);
    }

    return { keyFindings, costBreakdown };
  }

  private generateFollowUpQuestions(instances: any[], currentAccount: string): string[] {
    const followUps = [];

    if (instances.length === 0) {
      followUps.push("🔍 **Want to check other resources?** Ask about unattached volumes or running instances");
      return followUps;
    }

    // Cost-based follow-ups
    const sortedByCost = instances
      .filter(i => i.monthlyCost && parseFloat(i.monthlyCost) > 0)
      .sort((a, b) => parseFloat(b.monthlyCost) - parseFloat(a.monthlyCost));

    if (sortedByCost.length > 0) {
      const expensive = sortedByCost.slice(0, 2);
      followUps.push(`💰 **Analyze specific instances?** Tell me more about ${expensive.map(i => i.name).join(' or ')}`);
    }

    // Regional follow-ups
    const regions = [...new Set(instances.map(i => i.region).filter(Boolean))];
    if (regions.length > 1) {
      followUps.push(`📍 **Regional analysis?** Compare costs between ${regions.slice(0, 2).join(' and ')} regions`);
    }

    // Instance type follow-ups
    const expensiveTypes = [...new Set(sortedByCost.slice(0, 3).map(i => i.metadata?.instanceType).filter(Boolean))];
    if (expensiveTypes.length > 0) {
      followUps.push(`⚙️ **Right-sizing analysis?** Check if these ${expensiveTypes.join(', ')} instances are properly sized`);
    }

    // Account-specific follow-ups
    if (currentAccount === "All Accounts") {
      followUps.push(`🏢 **Focus on specific account?** Select an account from the dropdown for detailed analysis`);
    } else {
      followUps.push(`🔍 **Check other resources in ${currentAccount}?** Ask about running instances, unattached volumes, or cost trends`);
    }

    // Optimization follow-ups
    followUps.push(`📊 **Optimization recommendations?** Get specific suggestions for reducing costs`);
    followUps.push(`⏰ **Usage patterns?** Analyze when these instances were last used`);

    return followUps.slice(0, 4); // Limit to 4 follow-ups
  }

  private analyzePatterns(instances: any[], accounts: any[]): string[] {
    const patterns = [];
    
    if (instances.length === 0) return [];

    // Account concentration
    const accountStats = this.groupBy(instances, 'accountId');
    const sortedAccounts = Object.entries(accountStats)
      .sort(([,a], [,b]) => (b as any[]).length - (a as any[]).length);
    
    if (sortedAccounts.length > 0) {
      const [topAccountId, topInstances] = sortedAccounts[0];
      const account = accounts.find(a => a.id === parseInt(topAccountId));
      patterns.push(`- **${account?.name || 'Unknown'}** has the majority of stopped instances (${(topInstances as any[]).length}/${instances.length})`);
    }

    // Instance type diversity
    const instanceTypes = [...new Set(instances.map(i => i.metadata?.instanceType).filter(Boolean))];
    if (instanceTypes.length > 3) {
      patterns.push(`- Wide variety of instance types (${instanceTypes.length} different types) from cost-effective to high-performance`);
    }

    // Naming patterns
    const namePatterns = instances
      .map(i => i.name?.match(/^[a-z0-9]+-/)?.[0])
      .filter(Boolean);
    const uniquePatterns = [...new Set(namePatterns)];
    if (uniquePatterns.length > 2) {
      patterns.push(`- Multiple naming conventions suggest different projects or environments (${uniquePatterns.slice(0, 3).join(', ')}...)`);
    }

    return patterns;
  }
}

export const langGraphOrchestrator = new LangGraphOrchestrator();