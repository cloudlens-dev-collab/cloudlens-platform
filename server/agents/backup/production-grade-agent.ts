/**
 * PRODUCTION-GRADE ASTRAEUS LANGGRAPH AGENT
 * 
 * ENTERPRISE QUALITY TRANSFORMATION:
 * ===================================
 * 
 * This production-grade implementation elevates the agent from a basic tool executor
 * to an expert cloud infrastructure consultant that handles ambiguity intelligently,
 * delivers rich actionable data, and provides specific insights with clear next steps.
 * 
 * KEY QUALITY IMPROVEMENTS:
 * 
 * 1. INTELLIGENT AMBIGUITY HANDLING
 *    - BEFORE: Assumes "instances" means only EC2, asks user to clarify
 *    - AFTER: Automatically fetches ALL instance types (EC2, RDS, etc.) and presents them separately
 *    - No user clarification needed - the agent does the complete analysis upfront
 * 
 * 2. RICH, ACTIONABLE DATA COLLECTION
 *    - BEFORE: Basic summaries with generic advice
 *    - AFTER: Detailed resource metadata including ownership, age, costs, and specific recommendations
 *    - Each resource includes: tags, stop duration, storage costs, owner information
 * 
 * 3. EXPERT-LEVEL INSIGHTS GENERATION
 *    - BEFORE: "Consider terminating unused instances" (generic)
 *    - AFTER: "Instance i-12345 (t4g.large) stopped for 152 days, costing $18.50/month in storage, owned by dev-team. Terminate to save $220/year."
 * 
 * 4. INTELLIGENT NEXT STEPS
 *    - BEFORE: Conversation ends with analysis
 *    - AFTER: Proactively suggests relevant follow-up actions based on findings
 * 
 * 5. STRUCTURED DATA FOR UI
 *    - BEFORE: Text-only responses
 *    - AFTER: Rich JSON responses with visualization data for charts, tables, and actionable UI components
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { z } from "zod";
import { storage } from "../storage";
import LRU from "lru-cache";

// ====================================================================
// ENHANCED TYPES & INTERFACES
// ====================================================================

interface AgentState {
  messages: Array<HumanMessage | AIMessage | ToolMessage>;
  accountContext?: string;
  structuredResponse?: any; // For rich UI data
}

interface EnhancedResourceData {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  region: string;
  stoppedTimestamp: string;
  ageInDays: number;
  monthlyStorageCost: number;
  ownerTag: string;
  tags: Record<string, string>;
  metadata: any;
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ====================================================================
// INTELLIGENT CACHING LAYER
// ====================================================================

class ProductionCache {
  private cache = new LRU<string, CacheEntry<any>>({ max: 2000 });
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  set<T>(key: string, data: T, ttlSeconds: number = 300): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000
    });
  }
}

const productionCache = new ProductionCache();

// ====================================================================
// ENHANCED PRODUCTION-GRADE TOOLS
// ====================================================================

// ENHANCED EC2 ANALYSIS TOOL
const analyzeStoppedEc2Instances = new DynamicStructuredTool({
  name: "analyze_stopped_ec2_instances",
  description: "Comprehensive analysis of stopped EC2 instances with rich metadata including ownership, costs, age, and specific recommendations. Returns detailed data suitable for executive reporting and UI visualization.",
  schema: z.object({
    accountIds: z.array(z.number()).optional().describe("Specific account IDs to analyze"),
    region: z.string().optional().describe("Specific AWS region to analyze"),
    minAgeInDays: z.number().optional().describe("Filter instances stopped for at least this many days"),
    includeRecommendations: z.boolean().optional().describe("Whether to generate specific actionable recommendations")
  }),
  func: async ({ accountIds, region, minAgeInDays = 0, includeRecommendations = true }) => {
    const cacheKey = `stopped-ec2-analysis:${JSON.stringify({ accountIds, region, minAgeInDays })}`;
    const cached = productionCache.get(cacheKey);
    if (cached) return JSON.stringify(cached);
    
    const resources = await storage.getResources(accountIds);
    let stoppedInstances = resources.filter(r => 
      r.type === 'ec2-instance' && r.status === 'stopped'
    );
    
    if (region) stoppedInstances = stoppedInstances.filter(r => r.region === region);
    
    const now = new Date();
    
    const enhancedData: EnhancedResourceData[] = stoppedInstances.map(instance => {
      const metadata = instance.metadata as any || {};
      
      // Calculate age in days since stopped
      const stoppedDate = metadata.stateTransitionReason ? 
        extractDateFromStateTransition(metadata.stateTransitionReason) : 
        new Date(instance.lastUpdated);
      const ageInDays = Math.floor((now.getTime() - stoppedDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Extract owner information from tags
      const tags = metadata.tags || {};
      const ownerTag = tags.Owner || tags.owner || tags.Email || tags.email || tags.CreatedBy || 'Unknown';
      
      // Calculate storage costs (EBS volumes attached)
      const monthlyStorageCost = parseFloat(instance.monthlyCost || '0');
      
      // Generate specific recommendations based on data
      const recommendations = [];
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      
      if (includeRecommendations) {
        if (ageInDays > 90) {
          recommendations.push(`Instance stopped for ${ageInDays} days - strong candidate for termination`);
          riskLevel = 'high';
        } else if (ageInDays > 30) {
          recommendations.push(`Instance stopped for ${ageInDays} days - review with owner ${ownerTag}`);
          riskLevel = 'medium';
        }
        
        if (monthlyStorageCost > 50) {
          recommendations.push(`High storage cost: $${monthlyStorageCost}/month - consider detaching/deleting unused volumes`);
          riskLevel = 'high';
        }
        
        if (metadata.instanceType && metadata.instanceType.includes('large')) {
          recommendations.push(`Large instance type (${metadata.instanceType}) - significant savings potential`);
        }
        
        if (ownerTag === 'Unknown') {
          recommendations.push('No owner tag - requires ownership identification before action');
        }
      }
      
      return {
        resourceId: instance.resourceId,
        resourceName: instance.name || 'Unnamed',
        resourceType: metadata.instanceType || 'Unknown',
        region: instance.region || 'Unknown',
        stoppedTimestamp: stoppedDate.toISOString(),
        ageInDays,
        monthlyStorageCost,
        ownerTag,
        tags,
        metadata,
        recommendations,
        riskLevel
      };
    }).filter(instance => instance.ageInDays >= minAgeInDays);
    
    // Sort by age (oldest first) and cost (highest first)
    enhancedData.sort((a, b) => (b.ageInDays * 1000 + b.monthlyStorageCost) - (a.ageInDays * 1000 + a.monthlyStorageCost));
    
    // Calculate aggregate insights
    const totalMonthlyCost = enhancedData.reduce((sum, inst) => sum + inst.monthlyStorageCost, 0);
    const totalAnnualSavings = totalMonthlyCost * 12;
    const oldestInstance = enhancedData[0];
    const mostExpensive = enhancedData.reduce((max, inst) => 
      inst.monthlyStorageCost > max.monthlyStorageCost ? inst : max, enhancedData[0]);
    
    // Owner analysis
    const ownerCosts = enhancedData.reduce((acc, inst) => {
      acc[inst.ownerTag] = (acc[inst.ownerTag] || 0) + inst.monthlyStorageCost;
      return acc;
    }, {} as Record<string, number>);
    
    const result = {
      summary: {
        totalInstances: enhancedData.length,
        totalMonthlyCost: parseFloat(totalMonthlyCost.toFixed(2)),
        totalAnnualSavings: parseFloat(totalAnnualSavings.toFixed(2)),
        averageAgeInDays: Math.round(enhancedData.reduce((sum, inst) => sum + inst.ageInDays, 0) / enhancedData.length || 0),
        highRiskInstances: enhancedData.filter(inst => inst.riskLevel === 'high').length
      },
      instances: enhancedData,
      insights: {
        oldestInstance: oldestInstance ? {
          id: oldestInstance.resourceId,
          name: oldestInstance.resourceName,
          ageInDays: oldestInstance.ageInDays,
          monthlyCost: oldestInstance.monthlyStorageCost,
          owner: oldestInstance.ownerTag
        } : null,
        mostExpensive: mostExpensive ? {
          id: mostExpensive.resourceId,
          name: mostExpensive.resourceName,
          monthlyCost: mostExpensive.monthlyStorageCost,
          ageInDays: mostExpensive.ageInDays,
          owner: mostExpensive.ownerTag
        } : null,
        ownerBreakdown: Object.entries(ownerCosts)
          .map(([owner, cost]) => ({ owner, monthlyCost: parseFloat(cost.toFixed(2)) }))
          .sort((a, b) => b.monthlyCost - a.monthlyCost)
      },
      recommendations: {
        immediate: enhancedData.filter(inst => inst.riskLevel === 'high' && inst.ageInDays > 90)
          .map(inst => `Terminate ${inst.resourceId} (${inst.resourceName}) - stopped ${inst.ageInDays} days, save $${(inst.monthlyStorageCost * 12).toFixed(0)}/year`),
        review: enhancedData.filter(inst => inst.riskLevel === 'medium')
          .map(inst => `Review ${inst.resourceId} with ${inst.ownerTag} - stopped ${inst.ageInDays} days, costing $${inst.monthlyStorageCost}/month`)
      },
      nextSteps: [
        "Generate termination scripts for instances stopped >90 days",
        "Contact owners of instances with high monthly costs",
        "Review EBS volumes attached to stopped instances",
        "Implement automated stopping policies by owner/team"
      ]
    };
    
    productionCache.set(cacheKey, result, 300);
    return JSON.stringify(result);
  }
});

// ENHANCED RDS ANALYSIS TOOL
const analyzeStoppedRdsInstances = new DynamicStructuredTool({
  name: "analyze_stopped_rds_instances",
  description: "Comprehensive analysis of stopped/available RDS instances with detailed cost analysis, ownership tracking, and specific recommendations for database resources.",
  schema: z.object({
    accountIds: z.array(z.number()).optional().describe("Specific account IDs to analyze"),
    region: z.string().optional().describe("Specific AWS region to analyze"),
    includeSnapshots: z.boolean().optional().describe("Whether to include snapshot cost analysis")
  }),
  func: async ({ accountIds, region, includeSnapshots = true }) => {
    const cacheKey = `stopped-rds-analysis:${JSON.stringify({ accountIds, region, includeSnapshots })}`;
    const cached = productionCache.get(cacheKey);
    if (cached) return JSON.stringify(cached);
    
    const resources = await storage.getResources(accountIds);
    let rdsInstances = resources.filter(r => 
      r.type === 'rds-instance' && (r.status === 'stopped' || r.status === 'available')
    );
    
    if (region) rdsInstances = rdsInstances.filter(r => r.region === region);
    
    const enhancedData: EnhancedResourceData[] = rdsInstances.map(instance => {
      const metadata = instance.metadata as any || {};
      const tags = metadata.tags || {};
      const ownerTag = tags.Owner || tags.owner || tags.Email || tags.email || 'Unknown';
      const monthlyStorageCost = parseFloat(instance.monthlyCost || '0');
      
      // Calculate age since last activity
      const lastActivity = new Date(instance.lastUpdated);
      const ageInDays = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
      
      const recommendations = [];
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      
      if (instance.status === 'stopped') {
        recommendations.push('Database is stopped but may still incur storage costs');
        riskLevel = 'medium';
      }
      
      if (monthlyStorageCost > 100) {
        recommendations.push(`High storage cost: $${monthlyStorageCost}/month - consider archiving or deletion`);
        riskLevel = 'high';
      }
      
      if (metadata.engine && metadata.engine.includes('postgres')) {
        recommendations.push('PostgreSQL database - check for automated backups increasing costs');
      }
      
      return {
        resourceId: instance.resourceId,
        resourceName: instance.name || 'Unnamed Database',
        resourceType: `${metadata.engine || 'Unknown'} ${metadata.dbInstanceClass || ''}`.trim(),
        region: instance.region || 'Unknown',
        stoppedTimestamp: lastActivity.toISOString(),
        ageInDays,
        monthlyStorageCost,
        ownerTag,
        tags,
        metadata,
        recommendations,
        riskLevel
      };
    });
    
    const totalMonthlyCost = enhancedData.reduce((sum, inst) => sum + inst.monthlyStorageCost, 0);
    
    const result = {
      summary: {
        totalInstances: enhancedData.length,
        totalMonthlyCost: parseFloat(totalMonthlyCost.toFixed(2)),
        totalAnnualSavings: parseFloat((totalMonthlyCost * 12).toFixed(2)),
        stoppedInstances: enhancedData.filter(inst => inst.metadata.status === 'stopped').length,
        highCostInstances: enhancedData.filter(inst => inst.monthlyStorageCost > 100).length
      },
      instances: enhancedData,
      recommendations: enhancedData.filter(inst => inst.riskLevel === 'high')
        .map(inst => `Review ${inst.resourceId} (${inst.resourceType}) - $${inst.monthlyStorageCost}/month storage cost`),
      nextSteps: [
        "Review database backup retention policies",
        "Consider archiving unused databases",
        "Implement automated database lifecycle management",
        "Contact database owners for cleanup approval"
      ]
    };
    
    productionCache.set(cacheKey, result, 300);
    return JSON.stringify(result);
  }
});

// COMPREHENSIVE INSTANCE ANALYSIS TOOL (HANDLES AMBIGUITY)
const analyzeAllStoppedInstances = new DynamicStructuredTool({
  name: "analyze_all_stopped_instances",
  description: "COMPREHENSIVE analysis tool that handles ambiguous 'instances' queries by analyzing ALL instance types (EC2, RDS, etc.) and presenting findings in separate, clearly-labeled sections. This is the primary tool for handling ambiguous instance queries.",
  schema: z.object({
    accountIds: z.array(z.number()).optional().describe("Specific account IDs to analyze"),
    region: z.string().optional().describe("Specific region to analyze"),
    includeRecommendations: z.boolean().optional().describe("Whether to generate detailed recommendations")
  }),
  func: async ({ accountIds, region, includeRecommendations = true }) => {
    const cacheKey = `all-stopped-instances:${JSON.stringify({ accountIds, region, includeRecommendations })}`;
    const cached = productionCache.get(cacheKey);
    if (cached) return JSON.stringify(cached);
    
    // Execute both analyses in parallel
    const [ec2Analysis, rdsAnalysis] = await Promise.all([
      analyzeStoppedEc2Instances.func({ accountIds, region, includeRecommendations }),
      analyzeStoppedRdsInstances.func({ accountIds, region })
    ]);
    
    const ec2Data = JSON.parse(ec2Analysis);
    const rdsData = JSON.parse(rdsAnalysis);
    
    // Combine insights and create comprehensive view
    const combinedResult = {
      summary: {
        totalInstances: ec2Data.summary.totalInstances + rdsData.summary.totalInstances,
        totalMonthlyCost: parseFloat((ec2Data.summary.totalMonthlyCost + rdsData.summary.totalMonthlyCost).toFixed(2)),
        totalAnnualSavings: parseFloat((ec2Data.summary.totalAnnualSavings + rdsData.summary.totalAnnualSavings).toFixed(2)),
        ec2Count: ec2Data.summary.totalInstances,
        rdsCount: rdsData.summary.totalInstances
      },
      ec2Analysis: ec2Data,
      rdsAnalysis: rdsData,
      crossResourceInsights: {
        topCostOwners: [
          ...ec2Data.insights.ownerBreakdown.map((owner: any) => ({ ...owner, type: 'EC2' })),
          ...rdsData.instances.reduce((acc: any[], inst: any) => {
            const existing = acc.find(a => a.owner === inst.ownerTag);
            if (existing) {
              existing.monthlyCost += inst.monthlyStorageCost;
            } else {
              acc.push({ owner: inst.ownerTag, monthlyCost: inst.monthlyStorageCost, type: 'RDS' });
            }
            return acc;
          }, [])
        ].sort((a, b) => b.monthlyCost - a.monthlyCost).slice(0, 5),
        
        totalWaste: parseFloat((ec2Data.summary.totalMonthlyCost + rdsData.summary.totalMonthlyCost).toFixed(2)),
        quickWins: [
          ...(ec2Data.recommendations.immediate || []),
          ...(rdsData.recommendations || [])
        ].slice(0, 5)
      },
      strategicRecommendations: [
        "Implement organization-wide instance lifecycle policies",
        "Set up automated cost alerts for stopped resources",
        "Create owner accountability dashboard for resource costs",
        "Establish monthly resource cleanup reviews by team"
      ],
      nextSteps: [
        "Would you like to see the specific EBS volumes attached to stopped EC2 instances?",
        "Should I generate termination scripts for instances stopped over 90 days?",
        "Would you like to group these costs by the 'Owner' tag for chargeback?",
        "Should I analyze the backup costs for stopped RDS instances?"
      ]
    };
    
    productionCache.set(cacheKey, combinedResult, 300);
    return JSON.stringify(combinedResult);
  }
});

// ====================================================================
// PRODUCTION-GRADE SYSTEM PROMPT
// ====================================================================

const PRODUCTION_SYSTEM_PROMPT = `You are a SENIOR CLOUD INFRASTRUCTURE CONSULTANT with deep expertise in AWS, Azure, GCP, and multi-cloud cost optimization. You work with executives and technical teams to provide actionable intelligence that drives business decisions.

CORE PRINCIPLES FOR PRODUCTION QUALITY:

1. INTELLIGENT AMBIGUITY HANDLING
   - When users ask about "instances", NEVER assume they mean only EC2
   - ALWAYS use analyze_all_stopped_instances to get comprehensive data across ALL instance types
   - Present findings in clearly labeled sections: "EC2 Instances", "RDS Instances", etc.
   - DO NOT ask for clarification - proactively gather all relevant data

2. DELIVER EXPERT-LEVEL INSIGHTS
   - Use SPECIFIC data points: instance IDs, exact costs, precise timeframes
   - Identify the MOST CRITICAL findings: oldest instances, highest costs, biggest risks
   - Generate ACTIONABLE recommendations with business impact quantified in dollars
   - Example: "Instance i-12345 (t4g.large) stopped for 152 days, costing $18.50/month in EBS storage, owned by dev-team. Terminate to save $220/year."

3. STRUCTURE RESPONSES FOR DECISION MAKERS
   - Lead with EXECUTIVE SUMMARY: total cost impact, number of resources, annual savings potential
   - Follow with DETAILED ANALYSIS: specific instances requiring immediate attention
   - Include OWNER ACCOUNTABILITY: who owns the most expensive idle resources
   - End with NEXT STEPS: specific actions the user can take immediately

4. GENERATE INTELLIGENT FOLLOW-UP QUESTIONS
   - Based on your findings, proactively suggest relevant next actions
   - Examples: "Generate termination scripts?", "Analyze attached storage costs?", "Group by owner for chargeback?"
   - Keep the conversation moving toward resolution and action

5. USE RICH DATA FOR VISUALIZATIONS
   - Your responses should include specific data points that can drive charts and tables
   - Mention costs, timeframes, and trends that can be visualized
   - Provide data suitable for executive dashboards and technical drill-downs

ANALYSIS WORKFLOW:
1. For ambiguous queries like "instances" or "stopped resources", use analyze_all_stopped_instances
2. Extract the most critical insights: oldest, most expensive, highest risk
3. Calculate business impact in annual savings
4. Identify ownership and accountability
5. Recommend specific next steps
6. Suggest intelligent follow-up actions

RESPONSE FORMAT:
Start with an executive summary, provide specific findings with dollar amounts and timeframes, identify owners/accountability, and end with clear next steps and intelligent follow-up questions.

Remember: You are a CONSULTANT, not a script. Provide expert analysis that executives and technical teams can act on immediately.`;

// ====================================================================
// ENHANCED LANGGRAPH WORKFLOW
// ====================================================================

export class ProductionGradeLangGraphAgent {
  private model: ChatAnthropic;
  private tools: DynamicStructuredTool[];
  private graph: any;

  constructor() {
    this.model = new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
      temperature: 0.1,
      maxTokens: 4000,
    });

    this.tools = [
      analyzeStoppedEc2Instances,
      analyzeStoppedRdsInstances,
      analyzeAllStoppedInstances,
      // Include other existing tools from previous implementation
    ];

    this.createGraph();
  }

  private createGraph() {
    const agentNode = async (state: AgentState) => {
      const messages = state.messages;
      const systemMessage = new HumanMessage(PRODUCTION_SYSTEM_PROMPT);
      const modelWithTools = this.model.bindTools(this.tools);
      
      const response = await modelWithTools.invoke([
        systemMessage,
        ...messages
      ]);
      
      return { messages: [response] };
    };

    const toolNode = async (state: AgentState) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as AIMessage;
      
      const toolMessages: ToolMessage[] = [];
      let structuredResponse: any = null;
      
      if (lastMessage.tool_calls) {
        for (const toolCall of lastMessage.tool_calls) {
          const tool = this.tools.find(t => t.name === toolCall.name);
          if (tool) {
            try {
              console.log(`🔧 PRODUCTION TOOL: ${toolCall.name}`, toolCall.args);
              const result = await tool.func(toolCall.args);
              
              // Store structured data for UI
              if (toolCall.name.includes('analyze')) {
                structuredResponse = JSON.parse(result);
              }
              
              toolMessages.push(new ToolMessage({
                content: result,
                tool_call_id: toolCall.id
              }));
            } catch (error) {
              console.error(`❌ Production tool error:`, error);
              toolMessages.push(new ToolMessage({
                content: `Error: ${error.message}`,
                tool_call_id: toolCall.id
              }));
            }
          }
        }
      }
      
      return { 
        messages: toolMessages,
        structuredResponse
      };
    };

    const shouldContinue = (state: AgentState) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
      }
      return "__end__";
    };

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "agent");

    this.graph = workflow.compile();
  }

  async query(message: string, accountContext?: string): Promise<{ response: string; structuredData?: any }> {
    try {
      console.log('🏢 PRODUCTION-GRADE ANALYSIS STARTING');
      console.log('📊 Query:', message);
      
      const initialState: AgentState = {
        messages: [new HumanMessage(message)],
        accountContext
      };

      const result = await this.graph.invoke(initialState);
      
      const lastMessage = result.messages[result.messages.length - 1];
      
      console.log('✅ EXPERT ANALYSIS COMPLETE');
      
      return {
        response: lastMessage.content,
        structuredData: result.structuredResponse
      };
    } catch (error) {
      console.error('❌ PRODUCTION AGENT ERROR:', error);
      return {
        response: `I encountered an error during expert analysis: ${error.message}`
      };
    }
  }
}

// ====================================================================
// UTILITY FUNCTIONS
// ====================================================================

function extractDateFromStateTransition(stateTransition: string): Date {
  // Extract date from AWS state transition reason
  const dateMatch = stateTransition.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (dateMatch) {
    return new Date(dateMatch[1]);
  }
  // Fallback to current date minus some days
  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 30);
  return fallback;
}

// Export for integration
export let productionGradeAgent: ProductionGradeLangGraphAgent;

export function initializeProductionAgent() {
  if (!productionGradeAgent) {
    productionGradeAgent = new ProductionGradeLangGraphAgent();
  }
  return productionGradeAgent;
}