import React from "react";
import { Line } from "recharts";
import { LineChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

interface CostTrendChartProps {
  data: Array<{
    date: string;
    amount: number;
  }>;
  className?: string;
}

export function CostTrendChart({ data, className }: CostTrendChartProps) {
  const formatCurrency = (value: number) => {
    return `$${(value / 1000).toFixed(1)}k`;
  };

  const formatTooltip = (value: number, label: string) => {
    return [`$${value.toLocaleString()}`, "Cost"];
  };

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis 
            dataKey="date" 
            stroke="#64748b"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="#64748b"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCurrency}
          />
          <Tooltip 
            formatter={formatTooltip}
            labelStyle={{ color: "#374151" }}
            contentStyle={{ 
              backgroundColor: "white", 
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
            }}
          />
          <Line 
            type="monotone" 
            dataKey="amount" 
            stroke="hsl(207, 90%, 54%)" 
            strokeWidth={2}
            dot={{ fill: "hsl(207, 90%, 54%)", strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: "hsl(207, 90%, 54%)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
