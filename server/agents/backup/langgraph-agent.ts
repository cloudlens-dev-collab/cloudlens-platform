import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mcpManager } from "../mcp/manager";

// Agent state interface
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

// Initialize Claude model
function createModel() {
  // Use OpenAI due to Claude rate limits
  return new ChatOpenAI({
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.1,
  });
}

export class LangGraphAgent {
  private tools: DynamicStructuredTool[];
  private model: any;

  constructor() {
    this.tools = createMCPTools();
    this.model = createModel().bindTools(this.tools);
  }

  async query(message: string, accountContext?: string): Promise<string> {
    try {
      console.log("🚀 LANGGRAPH: Starting agent query:", message);
      console.log("🔧 LANGGRAPH: Available tools:", this.tools.map(t => t.name).join(', '));
      console.log("🤖 LANGGRAPH: Using OpenAI for MCP tools (Claude rate limited)");
      
      const systemMessage = `You are Astraeus, an expert cloud infrastructure analyst with access to real-time infrastructure data through MCP tools.

Available MCP tools:
${this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Account Context: ${accountContext || "All Accounts"}

For queries about:
- EC2 instances: Use get_resources with type="ec2-instance" and optionally region="eu-central-1"
- Stopped instances: Use get_resources with type="ec2-instance" and status="stopped"  
- Volumes: Use get_resources with type="ebs-volume"
- Stats/summaries: Use get_resource_stats
- Costs: Use get_costs

Always use tools to get authentic data from the database. Never invent resource IDs or data.`;

      let messages: Array<HumanMessage | AIMessage | ToolMessage> = [
        new HumanMessage(systemMessage),
        new HumanMessage(message)
      ];

      // Initial model call with timeout
      console.log("🤖 LANGGRAPH: Calling Claude with MCP tools...");
      let response;
      try {
        // Set a timeout for the initial Claude call
        response = await Promise.race([
          this.model.invoke(messages),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Claude timeout")), 45000))
        ]);
        messages.push(response);
      } catch (error) {
        console.error("❌ LANGGRAPH: Claude call timeout or error:", error);
        throw error;
      }

      let iterationCount = 0;
      const maxIterations = 3;

      // Handle tool calls
      while (response.tool_calls && response.tool_calls.length > 0 && iterationCount < maxIterations) {
        iterationCount++;
        console.log(`🔄 LANGGRAPH: Iteration ${iterationCount} - Claude wants to use ${response.tool_calls.length} tools:`);
        
        for (const toolCall of response.tool_calls) {
          console.log(`🔧 MCP TOOL CALL: ${toolCall.name} with params:`, JSON.stringify(toolCall.args, null, 2));
        }

        const toolMessages = [];
        
        for (const toolCall of response.tool_calls) {
          try {
            const tool = this.tools.find(t => t.name === toolCall.name);
            if (tool) {
              const result = await tool.func(toolCall.args);
              console.log(`✅ MCP TOOL RESULT: ${toolCall.name} returned:`, JSON.stringify(result).slice(0, 200) + '...');
              toolMessages.push(new ToolMessage({
                content: result,
                tool_call_id: toolCall.id
              }));
            } else {
              console.error(`❌ MCP TOOL ERROR: ${toolCall.name} not found`);
              toolMessages.push(new ToolMessage({
                content: `Tool ${toolCall.name} not found`,
                tool_call_id: toolCall.id
              }));
            }
          } catch (error) {
            console.error(`❌ MCP TOOL ERROR: ${toolCall.name} execution failed:`, error.message);
            toolMessages.push(new ToolMessage({
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
              tool_call_id: toolCall.id
            }));
          }
        }

        messages.push(...toolMessages);
        
        // Get next response from Claude with timeout
        console.log("🤖 LANGGRAPH: Getting Claude's response after tool execution...");
        try {
          response = await Promise.race([
            this.model.invoke(messages),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Claude timeout")), 25000))
          ]);
          messages.push(response);
        } catch (error) {
          console.error("❌ LANGGRAPH: Claude call timeout after tools:", error);
          throw error;
        }
      }

      console.log("✅ LANGGRAPH: Agent completed successfully");
      console.log(`📊 LANGGRAPH: Final response length: ${response.content?.length || 0} characters`);
      return response.content || "No response generated";

    } catch (error) {
      console.error("❌ LANGGRAPH ERROR:", error.message);
      throw new Error(`Agent execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const langGraphAgent = new LangGraphAgent();