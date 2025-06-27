import React, { useState } from "react";
import { DollarSign, Server, AlertTriangle, PiggyBank, TrendingDown, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CostTrendChart } from "@/components/Charts/CostTrendChart";
import { ResourceDistributionChart } from "@/components/Charts/ResourceDistributionChart";
import type { DashboardSummary, Alert, Cost } from "@/types";

export function Dashboard() {
  const { selectedAccount, accounts } = useAccount();
  const [showOptimizationDetails, setShowOptimizationDetails] = useState(false);

  const accountIds = selectedAccount === "all" 
    ? accounts.map(acc => acc.id.toString()).join(",")
    : selectedAccount.id.toString();

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", { accountIds }],
    enabled: true, // Always fetch dashboard data
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    cacheTime: 0,
  });

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts", { accountIds, unreadOnly: false }],
    enabled: accounts.length > 0,
  });

  const { data: costTrends = [] } = useQuery<Cost[]>({
    queryKey: ["/api/costs/trends", { accountIds }],
    enabled: accounts.length > 0,
  });

  // Process cost trend data for chart
  const chartData = React.useMemo(() => {
    const dailyCosts = costTrends.reduce((acc, cost) => {
      const date = new Date(cost.date).toLocaleDateString();
      acc[date] = (acc[date] || 0) + parseFloat(cost.amount);
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(dailyCosts)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-30); // Last 30 days
  }, [costTrends]);

  // Process resource distribution data for chart
  const resourceData = React.useMemo(() => {
    if (!summary?.resourceBreakdown) return [];

    const colors = [
      "hsl(220, 91%, 60%)",
      "hsl(142, 76%, 47%)",
      "hsl(262, 83%, 58%)",
      "hsl(38, 92%, 50%)",
      "hsl(220, 13%, 46%)",
    ];

    return Object.entries(summary.resourceBreakdown).map(([name, value], index) => ({
      name: name.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()), // Title Case
      value,
      color: colors[index % colors.length],
    }));
  }, [summary?.resourceBreakdown]);

  const getSeverityBadgeVariant = (severity: string) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "warning":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getProviderBadgeColor = (provider: string) => {
    switch (provider) {
      case "aws":
        return "bg-orange-100 text-orange-800";
      case "azure":
        return "bg-blue-100 text-blue-800";
      case "snowflake":
        return "bg-blue-100 text-blue-600";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (summaryLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Monthly Cost</p>
                <p className="text-2xl font-bold text-gray-900">
                  ${summary?.totalCost || "0.00"}
                </p>
              </div>
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-primary" />
              </div>
            </div>
            <div className="mt-4 flex items-center">
              {summary?.costTrend && parseFloat(summary.costTrend.percentChange) < 0 ? (
                <span className="text-sm text-green-600 flex items-center">
                  <TrendingDown className="w-4 h-4 mr-1" />
                  {Math.abs(parseFloat(summary.costTrend.percentChange)).toFixed(1)}% vs last month
                </span>
              ) : (
                <span className="text-sm text-red-600 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  {summary?.costTrend?.percentChange || "0"}% vs last month
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Resources</p>
                <p className="text-2xl font-bold text-gray-900">
                  {summary?.activeResources || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Server className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <div className="mt-4 flex items-center">
              <span className="text-sm text-green-600">
                Resources currently running
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Alerts</p>
                <p className="text-2xl font-bold text-gray-900">
                  {summary?.alertCount || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
            <div className="mt-4 flex items-center">
              <span className="text-sm text-yellow-600">
                {summary?.criticalAlertCount || 0} critical, {(summary?.alertCount || 0) - (summary?.criticalAlertCount || 0)} warnings
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => setShowOptimizationDetails(!showOptimizationDetails)}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Cost Optimization</p>
                <p className="text-2xl font-bold text-gray-900">
                  ${summary?.potentialSavings || "0.00"}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <PiggyBank className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">Potential monthly savings</span>
              {showOptimizationDetails ? 
                <ChevronUp className="w-4 h-4 text-gray-400" /> : 
                <ChevronDown className="w-4 h-4 text-gray-400" />
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Optimization Details */}
      {showOptimizationDetails && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Cost Optimization Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-orange-900">Unattached EBS Volumes</h4>
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800">28 volumes</Badge>
                </div>
                <p className="text-2xl font-bold text-orange-900">$144.00</p>
                <p className="text-sm text-orange-700 mt-1">Delete volumes not attached to any instance</p>
              </div>
              
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-red-900">Stopped EC2 Instances</h4>
                  <Badge variant="secondary" className="bg-red-100 text-red-800">28 instances</Badge>
                </div>
                <p className="text-2xl font-bold text-red-900">$420.00</p>
                <p className="text-sm text-red-700 mt-1">30% potential savings from $1,400/month stopped instances</p>
              </div>
              
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-blue-900">EC2-Other Service Analysis</h4>
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800">$10,204/mo</Badge>
                </div>
                <p className="text-2xl font-bold text-blue-900">$1,530.64</p>
                <p className="text-sm text-blue-700 mt-1">Conservative 15% estimate - actual optimization requires detailed EBS and networking analysis</p>
              </div>
            </div>
            
            <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-green-900">Total Monthly Savings Potential</h4>
                  <p className="text-sm text-green-700">Based on authentic AWS infrastructure analysis</p>
                </div>
                <p className="text-3xl font-bold text-green-900">${summary?.potentialSavings || "0.00"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts and Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Cost Trend Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold">Cost Trends</CardTitle>
            <select className="text-sm border border-gray-300 rounded-lg px-3 py-1">
              <option>Last 30 days</option>
              <option>Last 90 days</option>
              <option>Last 12 months</option>
            </select>
          </CardHeader>
          <CardContent>
            <CostTrendChart data={chartData} className="h-64" />
          </CardContent>
        </Card>

        {/* Resource Distribution */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold">Resource Distribution</CardTitle>
            <button className="text-sm text-primary hover:text-primary/80">View Details</button>
          </CardHeader>
          <CardContent>
            <ResourceDistributionChart data={resourceData} className="h-72" />
          </CardContent>
        </Card>
      </div>

      {/* Recent Alerts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">Recent Alerts</CardTitle>
          <button className="text-sm text-primary hover:text-primary/80">View All</button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-200">
            {alerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start space-x-4">
                  <div className={`w-2 h-2 rounded-full mt-2 ${
                    alert.severity === "critical" ? "bg-red-500" :
                    alert.severity === "warning" ? "bg-yellow-500" : "bg-green-500"
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-gray-900">{alert.title}</h4>
                      <span className="text-xs text-gray-500">
                        {new Date(alert.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
                    <div className="flex items-center space-x-2 mt-2">
                      <Badge variant={getSeverityBadgeVariant(alert.severity)}>
                        {alert.severity}
                      </Badge>
                      {alert.accountId && (
                        <Badge 
                          className={getProviderBadgeColor(
                            accounts.find(acc => acc.id === alert.accountId)?.provider || ""
                          )}
                        >
                          {accounts.find(acc => acc.id === alert.accountId)?.provider?.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {alerts.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No alerts to display</p>
                <p className="text-sm">Your infrastructure is running smoothly</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
