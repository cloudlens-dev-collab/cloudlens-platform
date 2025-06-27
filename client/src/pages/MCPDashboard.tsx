import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Activity, Zap, Clock, TrendingUp, Server, Brain, BarChart3 } from 'lucide-react';

interface MCPServer {
  name: string;
  version: string;
  tools: number;
  resources: number;
  prompts: number;
}

interface MCPTool {
  server: string;
  tool: {
    name: string;
    description: string;
    inputSchema: any;
  };
}

interface ToolUsageStats {
  totalUsage: number;
  successRate: number;
  averageExecutionTime: number;
  mostUsedTools: Array<{ name: string; count: number }>;
  recentErrors: Array<{ 
    toolName: string; 
    error: string; 
    timestamp: string;
    server: string;
  }>;
  serverStats: Record<string, any>;
}

export function MCPDashboard() {
  const queryClient = useQueryClient();

  const { data: servers, isLoading: serversLoading, error: serversError } = useQuery({
    queryKey: ['/api/mcp/servers'],
    retry: 3,
    retryDelay: 1000,
  });

  const { data: tools, isLoading: toolsLoading, error: toolsError } = useQuery({
    queryKey: ['/api/mcp/tools'],
    retry: 3,
    retryDelay: 1000,
  });

  const { data: usageStats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['/api/mcp/usage-stats'],
    retry: 3,
    retryDelay: 1000,
  });

  const { data: llmStats, error: llmError } = useQuery({
    queryKey: ['/api/mcp/llm-analytics'],
    retry: 3,
    retryDelay: 1000,
  });

  const executeToolMutation = useMutation({
    mutationFn: async ({ server, tool, params }: { server?: string; tool: string; params: any }) => {
      const response = await apiRequest('/api/mcp/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, tool, params, context: { source: 'dashboard' } })
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mcp/usage-stats'] });
    }
  });

  const handleTestTool = async (toolName: string, serverName: string) => {
    const testParams = getTestParamsForTool(toolName);
    executeToolMutation.mutate({ 
      server: serverName, 
      tool: toolName, 
      params: testParams 
    });
  };

  const getTestParamsForTool = (toolName: string): any => {
    switch (toolName) {
      case 'sync_account_resources':
        return { accountId: 1, force: false };
      case 'get_sync_status':
        return {};
      case 'validate_account_credentials':
        return { accountId: 1 };
      case 'get_llm_usage_stats':
        return { timeRange: '24h' };
      case 'recommend_optimal_model':
        return { queryType: 'cost-analysis', complexity: 'moderate' };
      default:
        return {};
    }
  };

  if (serversLoading || toolsLoading || statsLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity className="h-6 w-6" />
          <h1 className="text-2xl font-bold">MCP Dashboard</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-20 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Show error states with fallback data
  if (serversError || toolsError || statsError || llmError) {
    console.error('MCP Dashboard errors:', { serversError, toolsError, statsError, llmError });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Activity className="h-6 w-6" />
        <h1 className="text-2xl font-bold">MCP Dashboard</h1>
        <Badge variant="secondary" className="ml-auto">
          Model Context Protocol
        </Badge>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Servers</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{servers?.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              MCP servers running
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Tools</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tools?.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              Tools registered across all servers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Usage</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usageStats?.totalUsage || 0}</div>
            <p className="text-xs text-muted-foreground">
              Tool executions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {usageStats?.successRate ? `${usageStats.successRate.toFixed(1)}%` : '0%'}
            </div>
            <Progress 
              value={usageStats?.successRate || 0} 
              className="mt-2" 
            />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="servers" className="space-y-6">
        <TabsList>
          <TabsTrigger value="servers">Servers</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="usage">Usage Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="servers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>MCP Servers</CardTitle>
              <CardDescription>
                Model Context Protocol servers running in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {servers?.map((server) => (
                  <Card key={server.name} className="border-l-4 border-l-blue-500">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{server.name}</CardTitle>
                        <Badge variant="outline">v{server.version}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="font-medium">Tools</p>
                          <p className="text-2xl font-bold text-blue-600">{server.tools}</p>
                        </div>
                        <div>
                          <p className="font-medium">Resources</p>
                          <p className="text-2xl font-bold text-green-600">{server.resources}</p>
                        </div>
                        <div>
                          <p className="font-medium">Prompts</p>
                          <p className="text-2xl font-bold text-purple-600">{server.prompts}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Available Tools</CardTitle>
              <CardDescription>
                Tools registered across all MCP servers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool Name</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tools?.map((toolData, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-sm">
                        {toolData.tool.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{toolData.server}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {toolData.tool.description}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestTool(toolData.tool.name, toolData.server)}
                          disabled={executeToolMutation.isPending}
                        >
                          Test
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Most Used Tools</CardTitle>
              </CardHeader>
              <CardContent>
                {usageStats?.mostUsedTools?.length ? (
                  <div className="space-y-3">
                    {usageStats.mostUsedTools.slice(0, 5).map((tool, index) => (
                      <div key={tool.name} className="flex items-center justify-between">
                        <span className="text-sm font-mono">{tool.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">{tool.count}</span>
                          <div className="w-20 h-2 bg-gray-200 rounded">
                            <div 
                              className="h-2 bg-blue-500 rounded"
                              style={{ 
                                width: `${(tool.count / (usageStats.mostUsedTools[0]?.count || 1)) * 100}%` 
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No usage data available</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Average Execution Time</span>
                  <span className="font-mono text-sm">
                    {usageStats?.averageExecutionTime ? 
                      `${usageStats.averageExecutionTime.toFixed(0)}ms` : 
                      '0ms'
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Success Rate</span>
                  <span className="font-mono text-sm">
                    {usageStats?.successRate ? 
                      `${usageStats.successRate.toFixed(1)}%` : 
                      '0%'
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Total Executions</span>
                  <span className="font-mono text-sm">{usageStats?.totalUsage || 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Errors</CardTitle>
              <CardDescription>
                Recent tool execution errors for debugging
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usageStats?.recentErrors?.length ? (
                <div className="space-y-3">
                  {usageStats.recentErrors.slice(0, 5).map((error, index) => (
                    <Alert key={index} variant="destructive">
                      <AlertDescription>
                        <div className="flex justify-between items-start">
                          <div>
                            <strong>{error.toolName}</strong> on {error.server}
                            <p className="text-sm mt-1">{error.error}</p>
                          </div>
                          <span className="text-xs whitespace-nowrap">
                            {new Date(error.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No recent errors</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Server Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              {usageStats?.serverStats && Object.keys(usageStats.serverStats).length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(usageStats.serverStats).map(([serverName, stats]: [string, any]) => (
                    <Card key={serverName} className="border">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg">{serverName}</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground">Usage</p>
                            <p className="font-bold">{stats.totalUsage || 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Success Rate</p>
                            <p className="font-bold">{stats.successRate?.toFixed(1) || 0}%</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Avg Time</p>
                            <p className="font-bold">{stats.averageExecutionTime?.toFixed(0) || 0}ms</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Most Used</p>
                            <p className="font-bold text-xs">
                              {stats.mostUsedTools?.[0]?.name || 'None'}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No server statistics available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}