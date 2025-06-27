// Simple LLM service for non-infrastructure queries
export const llmService = {
  async query(message: string, context: string) {
    return {
      content: "I can help with infrastructure analysis and cost optimization. Please ask questions about your cloud resources, costs, or optimization opportunities.",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    };
  }
};