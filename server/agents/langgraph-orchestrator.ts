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
    };
  }

  private async analyzeQuery(state: typeof GraphState.State) {
    console.log("🔍 LANGGRAPH: Analyzing query intent and scope");
    
    const { query, accountIds, currentAccount } = state;
    
    // Analyze query for intent and entities
    const intent = this.extractIntent(query);
    const entities = this.extractEntities(query);
    
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
        focusAccount: currentAccount
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
    const { resources, accounts } = context;
    
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

      // Generate notable patterns
      const patterns = this.analyzePatterns(stoppedInstances, accounts);

      const response = `# 📊 Stopped Instances Overview

${currentAccount === "All Accounts" ? 
  `You have **${stoppedInstances.length} stopped EC2 instances** across your AWS infrastructure.` :
  `Account **${currentAccount}** has **${stoppedInstances.length} stopped EC2 instances**.`}

## 📍 Distribution by Region
${regionList}

## 🏢 Distribution by Account  
${accountList}

## 💰 Cost Impact
${totalMonthlyCost > 0 ? 
  `These stopped instances represent **$${totalMonthlyCost.toFixed(2)}/month** in storage costs.` :
  'Cost information is being calculated...'
}

While stopped instances don't incur compute charges, they still maintain EBS storage costs.

## 🔍 Notable Patterns
${patterns.join('\n')}

## 📈 Visual Analysis
The charts above show the distribution patterns and help identify optimization opportunities.

${currentAccount === "All Accounts" ? 
  "💡 **Tip**: Select a specific account from the dropdown to see detailed analysis for that account." :
  `💡 **Tip**: You're currently viewing data for ${currentAccount}. Switch to "All Accounts" to see the complete picture.`}

Would you like me to analyze any specific instances or provide recommendations for cost optimization?`;

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

  private analyzePatterns(instances: any[], accounts: any[]): string[] {
    const patterns = [];
    
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
    if (instanceTypes.length > 5) {
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

    return patterns.length > 0 ? patterns : ['- Analysis shows diverse instance distribution across your infrastructure'];
  }
}

export const langGraphOrchestrator = new LangGraphOrchestrator();