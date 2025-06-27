import React from "react";
import { BarChart3, Server, DollarSign, MessageSquare, Settings, Search, Plus, Download, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "resources", label: "Resources", icon: Server },
  { id: "costs", label: "Costs", icon: DollarSign },
  { id: "chat", label: "AI Chat", icon: MessageSquare, badge: "New" },
  { id: "accounts", label: "Accounts", icon: Settings },
  { id: "mcp", label: "MCP Tools", icon: Activity, badge: "Beta" },
];

const quickActions = [
  { label: "Search Resources", icon: Search },
  { label: "Add Connector", icon: Plus },
  { label: "Export Report", icon: Download },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex-shrink-0">
      <nav className="p-4 space-y-2">
        {/* Tab Navigation */}
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors",
                isActive
                  ? "bg-primary text-white"
                  : "text-gray-700 hover:bg-gray-100"
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{tab.label}</span>
              {tab.badge && (
                <span className="ml-auto px-2 py-1 bg-green-500 text-white text-xs rounded-full">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Quick Actions */}
        <div className="pt-6 border-t border-gray-200 mt-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Quick Actions
          </h3>
          <div className="space-y-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  className="w-full flex items-center space-x-3 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition-colors"
                >
                  <Icon className="w-4 h-4" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );
}
