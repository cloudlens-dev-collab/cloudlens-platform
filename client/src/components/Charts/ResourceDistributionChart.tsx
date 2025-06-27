import React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface ResourceDistributionChartProps {
  data: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  className?: string;
}

const COLORS = [
  "hsl(220, 91%, 60%)", // Blue
  "hsl(142, 76%, 47%)", // Green
  "hsl(262, 83%, 58%)", // Purple
  "hsl(38, 92%, 50%)",  // Orange
  "hsl(220, 13%, 46%)", // Gray
];

export function ResourceDistributionChart({ data, className }: ResourceDistributionChartProps) {
  const formatTooltip = (value: number, name: string) => {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const percentage = ((value / total) * 100).toFixed(1);
    return [`${value} resources (${percentage}%)`, name];
  };

  const total = data.reduce((sum, item) => sum + item.value, 0);
  
  // Get top 5 resource types and group the rest as "Others"
  const sortedData = [...data].sort((a, b) => b.value - a.value);
  const topData = sortedData.slice(0, 5);
  const othersValue = sortedData.slice(5).reduce((sum, item) => sum + item.value, 0);
  
  const chartData = topData;
  if (othersValue > 0) {
    chartData.push({
      name: "OTHERS",
      value: othersValue,
      color: "hsl(0, 0%, 60%)" // Gray for others
    });
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between h-full">
        {/* Pie Chart */}
        <div className="flex-1" style={{ height: '200px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.color || COLORS[index % COLORS.length]} 
                  />
                ))}
              </Pie>
              <Tooltip formatter={formatTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        {/* Custom Legend */}
        <div className="flex-1 pl-4">
          <div className="space-y-2">
            {chartData.map((item, index) => {
              const percentage = ((item.value / total) * 100).toFixed(1);
              return (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: item.color || COLORS[index % COLORS.length] }}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {item.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{item.value}</div>
                    <div className="text-xs text-gray-500">{percentage}%</div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Total */}
          <div className="mt-4 pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Total Resources</span>
              <span className="text-sm font-bold text-primary">{total}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
