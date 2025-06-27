import React from "react";
import { Bell, Star } from "lucide-react";
import { AccountSelector } from "@/components/Account/AccountSelector";
import { useAccount } from "@/contexts/AccountContext";
import { useQuery } from "@tanstack/react-query";
import type { Alert } from "@/types";

interface HeaderProps {
  currentTab: string;
}

export function Header({ currentTab }: HeaderProps) {
  const { selectedAccount, accounts } = useAccount();

  const accountIds = selectedAccount === "all" 
    ? accounts.map(acc => acc.id.toString()) 
    : [selectedAccount.id.toString()];

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts", { accountIds, unreadOnly: true }],
    enabled: accounts.length > 0,
  });

  const getAccountName = () => {
    if (selectedAccount === "all") {
      return "All Accounts";
    }
    return selectedAccount.name;
  };

  const getTabDisplayName = (tab: string) => {
    const tabNames: Record<string, string> = {
      dashboard: "Dashboard",
      resources: "Resources",
      costs: "Costs",
      chat: "AI Chat",
      accounts: "Accounts",
    };
    return tabNames[tab] || tab;
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Star className="w-4 h-4 text-white" fill="currentColor" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">Astraeus</h1>
            </div>
            
            {/* Breadcrumb Navigation */}
            <nav className="hidden md:flex items-center space-x-2 ml-8">
              <span className="text-sm text-gray-500">{getAccountName()}</span>
              <span className="text-xs text-gray-400">›</span>
              <span className="text-sm font-medium text-gray-900">
                {getTabDisplayName(currentTab)}
              </span>
            </nav>
          </div>

          {/* Account Selector and User Menu */}
          <div className="flex items-center space-x-4">
            <AccountSelector />

            {/* Notifications */}
            <button className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors">
              <Bell className="w-5 h-5" />
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {alerts.length > 9 ? "9+" : alerts.length}
                </span>
              )}
            </button>

            {/* User Menu */}
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">JD</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
