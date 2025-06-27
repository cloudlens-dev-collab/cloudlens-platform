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

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.color || COLORS[index % COLORS.length]} 
              />
            ))}
          </Pie>
          <Tooltip formatter={formatTooltip} />
          <Legend 
            position="bottom"
            wrapperStyle={{ paddingTop: "20px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
