import React, { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { FaAws, FaMicrosoft } from "react-icons/fa";
import { SiSnowflake } from "react-icons/si";
import { useAccount } from "@/contexts/AccountContext";
import { cn } from "@/lib/utils";
import type { Account } from "@/types";

export function AccountSelector() {
  const { selectedAccount, accounts, setSelectedAccount } = useAccount();
  const [isOpen, setIsOpen] = useState(false);

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "aws":
        return <FaAws className="text-orange-500 text-sm" />;
      case "azure":
        return <FaMicrosoft className="text-blue-500 text-sm" />;
      case "snowflake":
        return <SiSnowflake className="text-blue-400 text-sm" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500";
      case "error":
        return "bg-red-500";
      case "inactive":
        return "bg-gray-400";
      default:
        return "bg-yellow-500";
    }
  };

  const getSelectedAccountInfo = () => {
    if (selectedAccount === "all") {
      return {
        name: "All Accounts",
        subtitle: "Aggregated view",
        statusColor: "bg-green-500",
        icon: null,
      };
    }

    return {
      name: selectedAccount.name,
      subtitle: selectedAccount.accountId,
      statusColor: getStatusColor(selectedAccount.status),
      icon: getProviderIcon(selectedAccount.provider),
    };
  };

  const selectedInfo = getSelectedAccountInfo();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
      >
        <div className="flex items-center space-x-2">
          <div className={cn("w-2 h-2 rounded-full", selectedInfo.statusColor)} />
          <span className="text-sm font-medium text-gray-700">
            {selectedInfo.name}
          </span>
        </div>
        <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>
      
      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
            <div className="p-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Select Account</h3>
            </div>
            
            <div className="p-2">
              {/* All Accounts Option */}
              <button
                onClick={() => {
                  setSelectedAccount("all");
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-md"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900">All Accounts</div>
                    <div className="text-xs text-gray-500">Aggregated view</div>
                  </div>
                </div>
                {selectedAccount === "all" && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </button>

              {/* Individual Accounts */}
              {accounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => {
                    setSelectedAccount(account);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-md"
                >
                  <div className="flex items-center space-x-3">
                    <div className={cn("w-2 h-2 rounded-full", getStatusColor(account.status))} />
                    <div className="text-left">
                      <div className="text-sm font-medium text-gray-900">{account.name}</div>
                      <div className="text-xs text-gray-500">{account.accountId}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {selectedAccount !== "all" && selectedAccount.id === account.id && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                    {getProviderIcon(account.provider)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
