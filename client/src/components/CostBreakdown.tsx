import React from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, Package, HardDrive, Network, Loader2, BarChart3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";

interface CostBreakdownProps {
  resourceId: string;
  totalCost: string | null;
}

interface CostBreakdown {
  resourceId: string;
  totalCost: number;
  services: Record<string, number>;
  usageTypes: Record<string, number>;
  dailyCosts: Array<{
    date: string;
    service: string;
    cost: number;
  }>;
  period: string;
  message?: string;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function CostBreakdown({ resourceId, totalCost }: CostBreakdownProps) {
  const { data: breakdown, isLoading, error } = useQuery<CostBreakdown>({
    queryKey: [`/api/resources/${resourceId}/cost-breakdown`],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/resources/${resourceId}/cost-breakdown`);
      return response;
    },
    enabled: !!resourceId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="ml-2">Loading cost breakdown...</span>
      </div>
    );
  }

  if (error || !breakdown) {
    return (
      <div className="text-center p-8 text-gray-500">
        Failed to load cost breakdown
      </div>
    );
  }

  if (breakdown.message) {
    return (
      <div className="text-center p-8 text-gray-500">
        <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>{breakdown.message}</p>
        {totalCost && (
          <p className="mt-2 text-lg font-semibold">
            Total Cost: ${totalCost}
          </p>
        )}
      </div>
    );
  }

  // Prepare data for charts
  const serviceData = Object.entries(breakdown.services || {})
    .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);

  const usageTypeData = Object.entries(breakdown.usageTypes || {})
    .map(([name, value]) => ({ name: name.split(':').pop() || name, value: parseFloat(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10); // Top 10 usage types

  // Aggregate daily costs
  const dailyData = breakdown.dailyCosts?.reduce((acc, item) => {
    const date = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!acc[date]) {
      acc[date] = { date, total: 0, services: {} };
    }
    acc[date].total += item.cost;
    acc[date].services[item.service] = (acc[date].services[item.service] || 0) + item.cost;
    return acc;
  }, {} as Record<string, any>);

  const dailyChartData = Object.values(dailyData || {}).map((d: any) => ({
    ...d,
    total: parseFloat(d.total.toFixed(2))
  }));

  const getServiceIcon = (service: string) => {
    if (service.includes('EC2')) return <Package className="w-4 h-4" />;
    if (service.includes('Storage') || service.includes('S3')) return <HardDrive className="w-4 h-4" />;
    if (service.includes('Network') || service.includes('Transfer')) return <Network className="w-4 h-4" />;
    return <DollarSign className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">By Service</TabsTrigger>
          <TabsTrigger value="daily">Daily Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total Cost (MTD)</p>
                    <p className="text-2xl font-bold">${breakdown.totalCost.toFixed(2)}</p>
                  </div>
                  <DollarSign className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Services Used</p>
                    <p className="text-2xl font-bold">{Object.keys(breakdown.services || {}).length}</p>
                  </div>
                  <BarChart3 className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Service Distribution Pie Chart */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-4">Cost Distribution by Service</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={serviceData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {serviceData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-4">Service Breakdown</h4>
              <div className="space-y-3">
                {serviceData.map((service, index) => {
                  const percentage = (service.value / breakdown.totalCost) * 100;
                  return (
                    <div key={service.name} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {getServiceIcon(service.name)}
                          <span className="font-medium">{service.name}</span>
                        </div>
                        <span className="font-semibold">${service.value}</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                      <p className="text-xs text-gray-500">{percentage.toFixed(1)}% of total</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Usage Types */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-4">Top Usage Types</h4>
              <div className="space-y-2">
                {usageTypeData.map((usage) => (
                  <div key={usage.name} className="flex items-center justify-between py-1">
                    <span className="text-sm">{usage.name}</span>
                    <span className="font-medium">${usage.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-4">Daily Cost Trend</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(value) => `$${value}`} />
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="total" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      name="Total Daily Cost"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Average Daily:</span>
                  <span className="font-medium">
                    ${(breakdown.totalCost / (dailyChartData.length || 1)).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Days Tracked:</span>
                  <span className="font-medium">{dailyChartData.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}