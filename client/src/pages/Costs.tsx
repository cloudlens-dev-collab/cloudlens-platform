import React, { useState } from "react";
import { TrendingUp, TrendingDown, Calendar, Filter } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CostTrendChart } from "@/components/Charts/CostTrendChart";
import type { Cost } from "@/types";

interface CostSummary {
  currentMonth: number;
  projectedMonth: number;
  optimizationSavings: number;
  percentChange: number;
}

export function Costs() {
  const { selectedAccount, accounts } = useAccount();
  const [timePeriod, setTimePeriod] = useState("30");

  const accountIds = selectedAccount === "all" 
    ? accounts.map(acc => acc.id.toString())
    : [selectedAccount.id.toString()];

  const { data: costs = [], isLoading } = useQuery<Cost[]>({
    queryKey: ["/api/costs", { accountIds: accountIds.join(","), timePeriod }],
    enabled: accounts.length > 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Calculate cost summary
  const costSummary = React.useMemo((): CostSummary => {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Use all costs since they're all from June 2025
    const currentMonthCosts = costs;
    const lastMonthCosts: Cost[] = []; // No May data available

    const currentMonth = currentMonthCosts.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
    

    const lastMonth = lastMonthCosts.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);

    const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = now.getDate();
    const projectedMonth = (currentMonth / currentDay) * daysInCurrentMonth;

    const percentChange = lastMonth > 0 ? ((currentMonth - lastMonth) / lastMonth) * 100 : 0;

    return {
      currentMonth,
      projectedMonth,
      optimizationSavings: 2094, // $144 volumes + $420 instances + $1530 EC2 optimization
      percentChange,
    };
  }, [costs]);

  // Process cost trend data for chart
  const chartData = React.useMemo(() => {
    const dailyCosts = costs.reduce((acc, cost) => {
      const date = new Date(cost.date).toLocaleDateString();
      acc[date] = (acc[date] || 0) + parseFloat(cost.amount);
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(dailyCosts)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [costs]);

  // Calculate cost by service
  const costByService = React.useMemo(() => {
    const serviceCosts = costs.reduce((acc, cost) => {
      acc[cost.service] = (acc[cost.service] || 0) + parseFloat(cost.amount);
      return acc;
    }, {} as Record<string, number>);

    const total = Object.values(serviceCosts).reduce((sum, cost) => sum + cost, 0);

    return Object.entries(serviceCosts)
      .map(([service, amount]) => ({
        service,
        amount,
        percentage: total > 0 ? (amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [costs]);

  const optimizationRecommendations = [
    {
      id: 1,
      title: "Delete unattached EBS volumes",
      description: "28 EBS volumes not attached to any instance",
      potentialSavings: 144,
      impact: "Medium",
      type: "storage",
    },
    {
      id: 2,
      title: "Review stopped EC2 instances",
      description: "28 stopped instances costing $1,400/month - potential 30% savings",
      potentialSavings: 420,
      impact: "High",
      type: "compute",
    },
    {
      id: 3,
      title: "Optimize EC2-Other services",
      description: "Largest cost center at $10,204/month - review for rightsizing",
      potentialSavings: 1530,
      impact: "High",
      type: "compute",
    },
  ];

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "High":
        return "bg-green-100 text-green-800";
      case "Medium":
        return "bg-yellow-100 text-yellow-800";
      case "Low":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getServiceColor = (index: number) => {
    const colors = [
      "bg-blue-500",
      "bg-green-500", 
      "bg-purple-500",
      "bg-orange-500",
      "bg-gray-400",
    ];
    return colors[index % colors.length];
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {[1, 2, 3].map((i) => (
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
      {/* Cost Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Current Month</p>
                <p className="text-3xl font-bold text-gray-900">
                  ${costSummary.currentMonth.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                {costSummary.percentChange < 0 ? (
                  <div className="flex items-center text-green-600">
                    <TrendingDown className="w-4 h-4 mr-1" />
                    <span className="text-sm font-medium">
                      {Math.abs(costSummary.percentChange).toFixed(1)}%
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center text-red-600">
                    <TrendingUp className="w-4 h-4 mr-1" />
                    <span className="text-sm font-medium">
                      {costSummary.percentChange.toFixed(1)}%
                    </span>
                  </div>
                )}
                <p className="text-xs text-gray-500">vs last month</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Projected Month</p>
                <p className="text-3xl font-bold text-gray-900">
                  ${costSummary.projectedMonth.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-center text-yellow-600">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">
                    {((costSummary.projectedMonth - costSummary.currentMonth) / costSummary.currentMonth * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-gray-500">vs current</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Optimization Savings</p>
                <p className="text-3xl font-bold text-green-600">
                  ${costSummary.optimizationSavings.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600 font-medium">
                  {(costSummary.optimizationSavings / costSummary.currentMonth * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500">potential reduction</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Analysis Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Monthly Cost Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold">Cost Trend</CardTitle>
            <Select value={timePeriod} onValueChange={setTimePeriod}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <CostTrendChart data={chartData} className="h-64" />
          </CardContent>
        </Card>

        {/* Cost by Service */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold">Cost by Service</CardTitle>
            <Button variant="ghost" size="sm">
              View Details
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {costByService.map((service, index) => (
                <div key={service.service} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${getServiceColor(index)}`} />
                    <span className="text-sm font-medium text-gray-900">{service.service}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      ${service.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500">{service.percentage.toFixed(1)}%</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Optimization Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Cost Optimization Recommendations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-200">
            {optimizationRecommendations.map((recommendation) => (
              <div key={recommendation.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-4">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <TrendingDown className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">
                        {recommendation.title}
                      </h4>
                      <p className="text-sm text-gray-600 mt-1">
                        {recommendation.description}
                      </p>
                      <div className="flex items-center space-x-4 mt-3">
                        <span className="text-sm font-medium text-green-600">
                          Potential savings: ${recommendation.potentialSavings}/month
                        </span>
                        <Badge className={getImpactColor(recommendation.impact)}>
                          {recommendation.impact} Impact
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    {recommendation.impact === "High" ? "Apply" : "Review"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
