import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { mcpManager } from "../mcp/manager";

// Advanced agent state interface
interface AgentState {
  messages: Array<HumanMessage | AIMessage | ToolMessage>;
  accountContext?: string;
  query: string;
  analysisPhase: 'planning' | 'research' | 'analysis' | 'synthesis' | 'complete';
  researchPlan: {
    steps: Array<{
      id: string;
      description: string;
      tools: string[];
      completed: boolean;
      findings?: any;
    }>;
    priority: 'high' | 'medium' | 'low';
    complexity: 'simple' | 'moderate' | 'complex' | 'comprehensive';
  };
  collectedData: {
    resources: any[];
    costs: any[];
    accounts: any[];
    alerts: any[];
    stats: any;
  };
  insights: Array<{
    type: 'cost_optimization' | 'performance' | 'security' | 'compliance' | 'trend_analysis';
    severity: 'critical' | 'warning' | 'info';
    finding: string;
    evidence: any[];
    recommendation: string;
    impact: string;
  }>;
}

// Create LangChain tools from MCP infrastructure server
function createMCPTools() {
  const infrastructureServer = mcpManager.getServer("infrastructure");
  if (!infrastructureServer) {
    console.warn("Infrastructure server not available, creating empty tools array");
    return [];
  }
  const tools = infrastructureServer.getTools();
  
  console.log("Available MCP tools:", tools.map(t => t.name));
  
  return tools.map(tool => new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: z.object(tool.inputSchema.properties || {}),
    func: async (input) => {
      try {
        console.log(`🔧 Executing MCP tool: ${tool.name} with params:`, input);
        const result = await infrastructureServer.executeTool(tool.name, input);
        console.log(`✅ Tool ${tool.name} result:`, JSON.stringify(result).slice(0, 200) + "...");
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error(`❌ Tool ${tool.name} error:`, error);
        return `Error executing ${tool.name}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }));
}

// Initialize Claude model with advanced reasoning
function createModel() {
  return new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    apiKey: process.env.ANTHROPIC_API_KEY,
    temperature: 0.1,
    maxTokens: 4000,
  });
}

export class AdvancedLangGraphAgent {
  private tools: DynamicStructuredTool[];
  private model: any;
  private graph: any;
  private researchStrategies: Map<string, any>;

  constructor() {
    this.tools = createMCPTools();
    this.model = createModel();
    this.initializeResearchStrategies();
    this.createGraph();
  }

  private initializeResearchStrategies() {
    this.researchStrategies = new Map([
      ['cost_analysis', {
        steps: [
          { id: 'account_overview', description: 'Get all accounts and basic info', tools: ['get_accounts'] },
          { id: 'cost_breakdown', description: 'Analyze cost patterns by service and time', tools: ['get_costs'] },
          { id: 'resource_inventory', description: 'Catalog all resources for cost correlation', tools: ['get_resources'] },
          { id: 'optimization_scan', description: 'Identify cost optimization opportunities', tools: ['find_unattached_resources', 'get_resource_stats'] },
          { id: 'trend_analysis', description: 'Analyze spending trends and patterns', tools: ['get_costs'] }
        ],
        complexity: 'comprehensive'
      }],
      ['performance_analysis', {
        steps: [
          { id: 'resource_health', description: 'Check resource status and performance metrics', tools: ['get_resources', 'get_resource_stats'] },
          { id: 'capacity_analysis', description: 'Analyze utilization and capacity planning', tools: ['get_resources'] },
          { id: 'bottleneck_identification', description: 'Identify performance bottlenecks', tools: ['get_resource_stats'] },
          { id: 'alerting_review', description: 'Review active alerts and incidents', tools: ['get_alerts'] }
        ],
        complexity: 'moderate'
      }],
      ['security_audit', {
        steps: [
          { id: 'resource_inventory', description: 'Catalog all resources for security review', tools: ['get_resources'] },
          { id: 'access_analysis', description: 'Review security groups and access patterns', tools: ['get_resources'] },
          { id: 'compliance_check', description: 'Check compliance with security policies', tools: ['get_alerts'] },
          { id: 'vulnerability_scan', description: 'Identify potential security vulnerabilities', tools: ['get_resource_stats'] }
        ],
        complexity: 'complex'
      }],
      ['infrastructure_overview', {
        steps: [
          { id: 'multi_cloud_inventory', description: 'Get complete infrastructure across all clouds', tools: ['get_accounts', 'get_resources'] },
          { id: 'service_mapping', description: 'Map services and dependencies', tools: ['get_resources', 'get_resource_stats'] },
          { id: 'cost_correlation', description: 'Correlate resources with costs', tools: ['get_costs'] },
          { id: 'health_assessment', description: 'Assess overall infrastructure health', tools: ['get_alerts', 'get_resource_stats'] }
        ],
        complexity: 'comprehensive'
      }]
    ]);
  }

  private createGraph() {
    const workflow = new StateGraph({
      channels: {
        messages: {
          value: (x: any, y: any) => x.concat(y),
          default: () => []
        },
        accountContext: {
          value: (x: any, y: any) => y ?? x,
          default: () => undefined
        },
        query: {
          value: (x: any, y: any) => y ?? x,
          default: () => ""
        },
        analysisPhase: {
          value: (x: any, y: any) => y ?? x,
          default: () => "planning"
        },
        researchPlan: {
          value: (x: any, y: any) => y ?? x,
          default: () => ({ steps: [], priority: 'medium', complexity: 'simple' })
        },
        collectedData: {
          value: (x: any, y: any) => ({ ...x, ...y }),
          default: () => ({ resources: [], costs: [], accounts: [], alerts: [], stats: {} })
        },
        insights: {
          value: (x: any, y: any) => x.concat(y || []),
          default: () => []
        }
      }
    });

    // Add sophisticated multi-phase nodes
    workflow.addNode("planner", this.planResearch.bind(this));
    workflow.addNode("researcher", this.conductResearch.bind(this));
    workflow.addNode("analyzer", this.analyzeFindings.bind(this));
    workflow.addNode("synthesizer", this.synthesizeInsights.bind(this));
    workflow.addNode("responder", this.generateResponse.bind(this));

    // Create intelligent flow
    workflow.setEntryPoint("planner");
    workflow.addConditionalEdges("planner", this.routeFromPlanner.bind(this));
    workflow.addConditionalEdges("researcher", this.routeFromResearcher.bind(this));
    workflow.addConditionalEdges("analyzer", this.routeFromAnalyzer.bind(this));
    workflow.addEdge("synthesizer", "responder");
    workflow.addEdge("responder", "__end__");

    this.graph = workflow.compile();
  }

  // PHASE 1: Strategic Research Planning
  private async planResearch(state: AgentState): Promise<Partial<AgentState>> {
    console.log('🧭 PHASE 1: Strategic Research Planning');
    
    const query = state.query.toLowerCase();
    let strategy = 'infrastructure_overview'; // Default strategy
    
    // Intelligent strategy selection
    if (query.includes('cost') || query.includes('spend') || query.includes('bill') || query.includes('optimization')) {
      strategy = 'cost_analysis';
    } else if (query.includes('performance') || query.includes('utilization') || query.includes('capacity')) {
      strategy = 'performance_analysis';
    } else if (query.includes('security') || query.includes('compliance') || query.includes('audit')) {
      strategy = 'security_audit';
    }

    const selectedStrategy = this.researchStrategies.get(strategy);
    
    // Create comprehensive research plan
    const researchPlan = {
      steps: selectedStrategy.steps.map((step: any) => ({
        ...step,
        completed: false
      })),
      priority: query.includes('critical') || query.includes('urgent') ? 'high' : 'medium',
      complexity: selectedStrategy.complexity
    };

    console.log(`📋 Research Strategy: ${strategy}`);
    console.log(`🎯 Complexity Level: ${researchPlan.complexity}`);
    console.log(`📊 Research Steps: ${researchPlan.steps.length}`);

    return {
      analysisPhase: 'research',
      researchPlan,
      messages: [new AIMessage(`Initiating ${researchPlan.complexity} analysis with ${researchPlan.steps.length} research steps...`)]
    };
  }

  // PHASE 2: Deep Data Research
  private async conductResearch(state: AgentState): Promise<Partial<AgentState>> {
    console.log('🔬 PHASE 2: Deep Data Research');
    
    const collectedData = { ...state.collectedData };
    const updatedPlan = { ...state.researchPlan };

    for (const step of updatedPlan.steps) {
      if (!step.completed) {
        console.log(`🔍 Executing research step: ${step.description}`);
        
        const stepFindings: any = {};
        
        // Execute all tools for this step
        for (const toolName of step.tools) {
          try {
            const tool = this.tools.find(t => t.name === toolName);
            if (tool) {
              console.log(`⚙️ Running tool: ${toolName}`);
              
              // Intelligent parameter selection based on context
              let params = {};
              if (state.accountContext) {
                try {
                  // Try to parse as JSON array first
                  params = { accountIds: JSON.parse(state.accountContext) };
                } catch (error) {
                  // If not JSON, treat as single account ID or leave empty for all accounts
                  console.log(`Account context not JSON, using all accounts: ${state.accountContext}`);
                  params = {}; // Use all accounts when context is not parseable
                }
              }
              
              const result = await tool.func(params);
              let parsedResult;
              try {
                parsedResult = JSON.parse(result);
              } catch (error) {
                console.error(`Failed to parse tool result for ${toolName}:`, error);
                parsedResult = result; // Use raw result if JSON parse fails
              }
              
              stepFindings[toolName] = parsedResult;
              
              // Store in collected data
              if (toolName === 'get_resources') collectedData.resources = parsedResult;
              if (toolName === 'get_costs') collectedData.costs = parsedResult;
              if (toolName === 'get_accounts') collectedData.accounts = parsedResult;
              if (toolName === 'get_alerts') collectedData.alerts = parsedResult;
              if (toolName === 'get_resource_stats') collectedData.stats = parsedResult;
            }
          } catch (error) {
            console.error(`❌ Error in tool ${toolName}:`, error);
            stepFindings[toolName] = { error: error.message };
          }
        }
        
        step.findings = stepFindings;
        step.completed = true;
        
        console.log(`✅ Completed research step: ${step.id}`);
      }
    }

    console.log('📊 Research Phase Complete - Data Collected:');
    console.log(`- Resources: ${Array.isArray(collectedData.resources) ? collectedData.resources.length : 'Invalid data'}`);
    console.log(`- Costs: ${Array.isArray(collectedData.costs) ? collectedData.costs.length : 'Invalid data'}`);
    console.log(`- Accounts: ${Array.isArray(collectedData.accounts) ? collectedData.accounts.length : 'Invalid data'}`);
    console.log(`- Alerts: ${Array.isArray(collectedData.alerts) ? collectedData.alerts.length : 'Invalid data'}`);

    return {
      analysisPhase: 'analysis',
      researchPlan: updatedPlan,
      collectedData,
      messages: [new AIMessage('Research complete. Analyzing findings for deep insights...')]
    };
  }

  // PHASE 3: Advanced Analysis & Pattern Recognition
  private async analyzeFindings(state: AgentState): Promise<Partial<AgentState>> {
    console.log('🧠 PHASE 3: Advanced Analysis & Pattern Recognition');
    
    const insights: any[] = [];
    const { resources, costs, accounts, alerts, stats } = state.collectedData;

    // Cost Optimization Analysis
    const validCosts = Array.isArray(costs) ? costs : [];
    if (validCosts.length > 0) {
      const totalCost = validCosts.reduce((sum: number, cost: any) => sum + parseFloat(cost.amount || 0), 0);
      const topServices = this.aggregateCostsByService(validCosts).slice(0, 5);
      
      insights.push({
        type: 'cost_optimization',
        severity: totalCost > 20000 ? 'critical' : totalCost > 10000 ? 'warning' : 'info',
        finding: `Monthly infrastructure cost: $${totalCost.toFixed(2)}`,
        evidence: topServices,
        recommendation: this.generateCostOptimizationRecommendation(topServices, totalCost),
        impact: `Potential monthly savings identified`
      });
    }

    // Performance Analysis
    const validResources = Array.isArray(resources) ? resources : [];
    if (validResources.length > 0) {
      const stoppedInstances = validResources.filter((r: any) => 
        r.type === 'ec2-instance' && r.status === 'stopped'
      );
      
      const unattachedVolumes = validResources.filter((r: any) => 
        r.type === 'ebs-volume' && r.status === 'available'
      );

      console.log(`🔍 ANALYSIS: Found ${stoppedInstances.length} stopped instances, ${unattachedVolumes.length} unattached volumes from ${validResources.length} total resources`);

      if (stoppedInstances.length > 0) {
        insights.push({
          type: 'cost_optimization',
          severity: 'warning',
          finding: `${stoppedInstances.length} stopped EC2 instances consuming costs`,
          evidence: stoppedInstances.slice(0, 5),
          recommendation: 'Consider terminating unused instances or scheduling them appropriately',
          impact: 'Reduce monthly costs and improve resource utilization'
        });
      }

      if (unattachedVolumes.length > 0) {
        const volumeCost = unattachedVolumes.reduce((sum: number, vol: any) => {
          const size = parseInt(vol.metadata?.size || '0');
          return sum + (size * 0.08); // Approximate cost per GB
        }, 0);

        insights.push({
          type: 'cost_optimization',
          severity: 'warning',
          finding: `${unattachedVolumes.length} unattached EBS volumes costing ~$${volumeCost.toFixed(2)}/month`,
          evidence: unattachedVolumes.slice(0, 5),
          recommendation: 'Review and delete unused volumes after confirming they contain no critical data',
          impact: `Save approximately $${volumeCost.toFixed(2)} monthly`
        });
      }
    }

    // Security Analysis
    const securityGroups = resources.filter((r: any) => r.type === 'security-group');
    if (securityGroups.length > 0) {
      insights.push({
        type: 'security',
        severity: 'info',
        finding: `${securityGroups.length} security groups configured`,
        evidence: securityGroups.slice(0, 3),
        recommendation: 'Regularly audit security group rules for least privilege access',
        impact: 'Maintain security posture and compliance'
      });
    }

    // Alert Analysis
    if (alerts.length > 0) {
      const criticalAlerts = alerts.filter((a: any) => a.severity === 'critical');
      if (criticalAlerts.length > 0) {
        insights.push({
          type: 'performance',
          severity: 'critical',
          finding: `${criticalAlerts.length} critical alerts require immediate attention`,
          evidence: criticalAlerts,
          recommendation: 'Address critical alerts immediately to prevent service disruption',
          impact: 'Ensure system stability and performance'
        });
      }
    }

    console.log(`💡 Generated ${insights.length} actionable insights`);

    return {
      analysisPhase: 'synthesis',
      insights,
      messages: [new AIMessage(`Analysis complete. Generated ${insights.length} actionable insights.`)]
    };
  }

  // PHASE 4: Insight Synthesis
  private async synthesizeInsights(state: AgentState): Promise<Partial<AgentState>> {
    console.log('🔗 PHASE 4: Insight Synthesis');
    
    const { insights, collectedData } = state;
    
    // Prioritize insights by severity and impact
    const prioritizedInsights = insights.sort((a, b) => {
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    // Create comprehensive summary
    const summary = {
      totalResources: collectedData.resources.length,
      totalCosts: collectedData.costs.reduce((sum: number, cost: any) => sum + parseFloat(cost.amount || 0), 0),
      criticalIssues: insights.filter(i => i.severity === 'critical').length,
      optimizationOpportunities: insights.filter(i => i.type === 'cost_optimization').length,
      securityFindings: insights.filter(i => i.type === 'security').length
    };

    console.log('📋 Synthesis Summary:');
    console.log(`- Total Resources: ${summary.totalResources}`);
    console.log(`- Total Monthly Cost: $${summary.totalCosts.toFixed(2)}`);
    console.log(`- Critical Issues: ${summary.criticalIssues}`);
    console.log(`- Optimization Opportunities: ${summary.optimizationOpportunities}`);

    return {
      analysisPhase: 'complete',
      insights: prioritizedInsights,
      messages: [new AIMessage('Synthesis complete. Generating comprehensive response...')]
    };
  }

  // PHASE 5: Comprehensive Response Generation
  private async generateResponse(state: AgentState): Promise<Partial<AgentState>> {
    console.log('📝 PHASE 5: Comprehensive Response Generation');
    
    const prompt = this.buildComprehensivePrompt(state);
    
    const response = await this.model.invoke([
      new HumanMessage(prompt)
    ]);

    console.log('✅ Generated comprehensive response based on deep analysis');

    return {
      messages: [response]
    };
  }

  private buildComprehensivePrompt(state: AgentState): string {
    const { query, collectedData, insights, researchPlan } = state;
    
    return `
You are an expert cloud infrastructure analyst. Based on extensive research and analysis, provide a comprehensive response to the user's query.

ORIGINAL QUERY: "${query}"

RESEARCH COMPLETED:
- Strategy: ${researchPlan.complexity} analysis with ${researchPlan.steps.length} research steps
- Data Collected: ${collectedData.resources.length} resources, ${collectedData.costs.length} cost records, ${collectedData.accounts.length} accounts

KEY FINDINGS AND INSIGHTS:
${insights.map((insight, i) => `
${i + 1}. [${insight.severity.toUpperCase()}] ${insight.finding}
   Recommendation: ${insight.recommendation}
   Impact: ${insight.impact}
   Evidence: ${JSON.stringify(insight.evidence.slice(0, 2))}
`).join('\n')}

INFRASTRUCTURE SUMMARY:
- Total Resources: ${collectedData.resources.length}
- Total Monthly Cost: $${collectedData.costs.reduce((sum: number, cost: any) => sum + parseFloat(cost.amount || 0), 0).toFixed(2)}
- Active Accounts: ${collectedData.accounts.length}
- Active Alerts: ${collectedData.alerts.length}

Please provide a comprehensive, actionable response that:
1. Directly answers the user's question
2. Provides specific, data-driven insights
3. Includes actionable recommendations with business impact
4. Uses authentic data from the infrastructure analysis
5. Prioritizes findings by severity and potential impact

Format the response professionally for a infrastructure decision-maker.
`;
  }

  private aggregateCostsByService(costs: any[]) {
    const serviceMap = new Map();
    
    costs.forEach(cost => {
      const service = cost.service || 'Unknown';
      const amount = parseFloat(cost.amount || 0);
      serviceMap.set(service, (serviceMap.get(service) || 0) + amount);
    });

    return Array.from(serviceMap.entries())
      .map(([service, total]) => ({ service, total }))
      .sort((a, b) => b.total - a.total);
  }

  private generateCostOptimizationRecommendation(topServices: any[], totalCost: number): string {
    const topService = topServices[0];
    if (topService && topService.total > totalCost * 0.3) {
      return `Focus optimization efforts on ${topService.service} which represents ${((topService.total / totalCost) * 100).toFixed(1)}% of total costs`;
    }
    return 'Review resource utilization across all services for optimization opportunities';
  }

  // Routing Logic
  private routeFromPlanner(state: AgentState): string {
    return "researcher";
  }

  private routeFromResearcher(state: AgentState): string {
    return "analyzer";
  }

  private routeFromAnalyzer(state: AgentState): string {
    return "synthesizer";
  }

  async query(message: string, accountContext?: string): Promise<string> {
    try {
      const initialState: AgentState = {
        messages: [new HumanMessage(message)],
        accountContext,
        query: message,
        analysisPhase: 'planning',
        researchPlan: { steps: [], priority: 'medium', complexity: 'simple' },
        collectedData: { resources: [], costs: [], accounts: [], alerts: [], stats: {} },
        insights: []
      };

      console.log('🧠 ADVANCED LANGGRAPH AGENT: Initiating deep analysis');
      console.log('📊 Query:', message);
      console.log('🎯 Phase: Multi-step research and analysis');
      if (accountContext) {
        console.log('🏢 Account Context:', accountContext);
      }

      const result = await this.graph.invoke(initialState);
      
      console.log('✅ ANALYSIS COMPLETE: Generated comprehensive response');
      console.log('📈 Research Steps:', result.researchPlan.steps.length);
      console.log('💡 Insights Generated:', result.insights.length);
      
      const lastMessage = result.messages[result.messages.length - 1];
      return lastMessage.content;
    } catch (error) {
      console.error('❌ LANGGRAPH ERROR:', error);
      return `I encountered an error during deep analysis: ${error.message}`;
    }
  }
}

// Export as lazy initialization to avoid circular dependencies
export let advancedLangGraphAgent: AdvancedLangGraphAgent;

// Initialize after MCP manager is ready
export function initializeAdvancedAgent() {
  if (!advancedLangGraphAgent) {
    advancedLangGraphAgent = new AdvancedLangGraphAgent();
  }
  return advancedLangGraphAgent;
}