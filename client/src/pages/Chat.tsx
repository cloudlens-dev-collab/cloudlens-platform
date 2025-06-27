import React, { useState, useRef, useEffect } from "react";
import { Send, BarChart3, Server, Lightbulb, Paperclip, RotateCcw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ChatMessage, LLMProvider } from "@/types";

export function Chat() {
  const { selectedAccount, accounts } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<LLMProvider>("claude");
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const accountContext = selectedAccount === "all" 
    ? "All Accounts" 
    : selectedAccount.name;

  const { data: messages = [], isLoading } = useQuery<ChatMessage[]>({
    queryKey: [`/api/chat/${sessionId}`],
    enabled: !!sessionId,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    staleTime: 0,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ message, model, accountContext }: {
      message: string;
      model: string;
      accountContext: string;
    }) => {
      return apiRequest("POST", `/api/chat/${sessionId}`, {
        message,
        model,
        accountContext,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/chat/${sessionId}`] });
      setMessage("");
    },
    onError: () => {
      toast({
        title: "Failed to send message",
        description: "Please try again",
        variant: "destructive",
      });
    },
  });

  const clearChatMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/chat/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat", sessionId] });
      toast({
        title: "Chat cleared",
        description: "Conversation history has been cleared",
      });
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!message.trim() || sendMessageMutation.isPending) return;

    sendMessageMutation.mutate({
      message: message.trim(),
      model: selectedModel,
      accountContext,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickAction = (prompt: string) => {
    setMessage(prompt);
    textareaRef.current?.focus();
  };

  const getModelDisplayName = (model: string) => {
    const modelNames: Record<string, string> = {
      openai: "ChatGPT-4",
      claude: "Claude 3.5 Sonnet",
      gemini: "Google Gemini Pro",
      perplexity: "Perplexity AI",
    };
    return modelNames[model] || model;
  };

  const formatMessageContent = (content: string) => {
    // Simple formatting for tables and structured data
    if (content.includes("|") && content.includes("---")) {
      // Detect table format and render as HTML table
      const lines = content.split("\n");
      const tableStart = lines.findIndex(line => line.includes("---"));
      
      if (tableStart > 0) {
        const beforeTable = lines.slice(0, tableStart - 1).join("\n");
        const headers = lines[tableStart - 1].split("|").map(h => h.trim()).filter(Boolean);
        const afterTableStart = lines.findIndex((line, idx) => idx > tableStart && !line.includes("|"));
        const tableRows = lines.slice(tableStart + 1, afterTableStart > 0 ? afterTableStart : undefined);
        const afterTable = afterTableStart > 0 ? lines.slice(afterTableStart).join("\n") : "";

        return (
          <div>
            {beforeTable && <p className="mb-4 whitespace-pre-wrap">{beforeTable}</p>}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {headers.map((header, idx) => (
                      <th key={idx} className="px-3 py-2 text-left font-medium text-gray-700">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {tableRows.map((row, idx) => {
                    const cells = row.split("|").map(c => c.trim()).filter(Boolean);
                    return (
                      <tr key={idx}>
                        {cells.map((cell, cellIdx) => (
                          <td key={cellIdx} className="px-3 py-2 text-gray-900">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {afterTable && <p className="whitespace-pre-wrap">{afterTable}</p>}
          </div>
        );
      }
    }

    return <p className="whitespace-pre-wrap">{content}</p>;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* AI Model Selection */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">AI Assistant</h3>
            <div className="flex items-center space-x-4">
              <Select value={selectedModel} onValueChange={(value: LLMProvider) => setSelectedModel(value)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude 3.5 Sonnet</SelectItem>
                  <SelectItem value="openai">ChatGPT-4</SelectItem>
                  <SelectItem value="gemini">Google Gemini Pro</SelectItem>
                  <SelectItem value="perplexity">Perplexity AI</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-xs text-gray-600">Connected</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chat Interface */}
      <Card className="flex flex-col h-[calc(100vh-300px)]">
        {/* Chat Header */}
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg font-semibold">Infrastructure Chat</CardTitle>
            <p className="text-sm text-gray-600">Ask questions about your multi-cloud infrastructure</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearChatMutation.mutate()}
            disabled={clearChatMutation.isPending}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Clear Chat
          </Button>
        </CardHeader>

        {/* Chat Messages */}
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Server className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Welcome to Astraeus AI</h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">
                I'm your AI assistant for multi-cloud infrastructure management. 
                Ask me about costs, resources, performance, or optimization opportunities.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Badge variant="secondary" className="cursor-pointer hover:bg-primary/10">
                  Current account: {accountContext}
                </Badge>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start space-x-3 ${
                  msg.role === "user" ? "justify-end" : ""
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                    <Server className="w-4 h-4 text-white" />
                  </div>
                )}
                
                <div className={`flex-1 ${msg.role === "user" ? "max-w-md" : ""}`}>
                  <div
                    className={`rounded-lg p-4 ${
                      msg.role === "user"
                        ? "bg-primary text-white ml-auto"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    {formatMessageContent(msg.content)}
                  </div>
                  <p className={`text-xs text-gray-500 mt-2 ${
                    msg.role === "user" ? "text-right" : ""
                  }`}>
                    {msg.role === "assistant" && msg.model && getModelDisplayName(msg.model)} • {" "}
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-medium">U</span>
                  </div>
                )}
              </div>
            ))
          )}

          {sendMessageMutation.isPending && (
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                <Server className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce-delayed"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce-delayed"></div>
                    </div>
                    <span className="text-sm text-gray-600">Analyzing your infrastructure...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        {/* Chat Input */}
        <CardContent className="p-4 border-t border-gray-200">
          <div className="flex items-end space-x-3">
            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                placeholder="Ask about your infrastructure costs, resources, or performance..."
                className="resize-none"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sendMessageMutation.isPending}
              />
            </div>
            <Button
              onClick={handleSendMessage}
              disabled={!message.trim() || sendMessageMutation.isPending}
              className="px-6 py-3"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center space-x-4 text-xs text-gray-500">
              <span>Press Shift + Enter for new line</span>
              <span>•</span>
              <span>Context: {accountContext}</span>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-gray-700">
                <Paperclip className="w-3 h-3 mr-1" />
                Attach file
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Button
          variant="outline"
          className="p-4 h-auto justify-start"
          onClick={() => handleQuickAction("Show me the total and individual costs of all our production EC2 instances over the last quarter.")}
        >
          <div className="flex items-center space-x-3">
            <BarChart3 className="w-5 h-5 text-primary" />
            <div className="text-left">
              <h4 className="text-sm font-medium text-gray-900">Cost Analysis</h4>
              <p className="text-xs text-gray-600">Analyze spending patterns</p>
            </div>
          </div>
        </Button>

        <Button
          variant="outline"
          className="p-4 h-auto justify-start"
          onClick={() => handleQuickAction("Which Kubernetes pods are consuming the most resources right now?")}
        >
          <div className="flex items-center space-x-3">
            <Server className="w-5 h-5 text-primary" />
            <div className="text-left">
              <h4 className="text-sm font-medium text-gray-900">Resource Health</h4>
              <p className="text-xs text-gray-600">Check system performance</p>
            </div>
          </div>
        </Button>

        <Button
          variant="outline"
          className="p-4 h-auto justify-start"
          onClick={() => handleQuickAction("What are all the unattached EBS volumes across all our AWS accounts, and what's their potential cost savings?")}
        >
          <div className="flex items-center space-x-3">
            <Lightbulb className="w-5 h-5 text-primary" />
            <div className="text-left">
              <h4 className="text-sm font-medium text-gray-900">Optimization</h4>
              <p className="text-xs text-gray-600">Get improvement suggestions</p>
            </div>
          </div>
        </Button>
      </div>
    </div>
  );
}
