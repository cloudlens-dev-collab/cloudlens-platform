import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, AccountContextType } from "@/types";

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error("useAccount must be used within an AccountProvider");
  }
  return context;
}

interface AccountProviderProps {
  children: ReactNode;
}

export function AccountProvider({ children }: AccountProviderProps) {
  const [selectedAccount, setSelectedAccount] = useState<Account | "all">("all");
  const queryClient = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
    // Remove auto-refresh to prevent unnecessary Azure calls
  });

  const refreshAccounts = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
  };

  // Auto-select AWS account (which has cost data) if none selected and accounts are loaded
  useEffect(() => {
    if (selectedAccount === "all" && accounts.length > 0) {
      // Find AWS account which has cost data
      const awsAccount = accounts.find(acc => acc.provider === 'aws');
      if (awsAccount) {
        setSelectedAccount(awsAccount);
      }
    }
  }, [accounts, selectedAccount]);

  const value: AccountContextType = {
    selectedAccount,
    accounts,
    setSelectedAccount,
    refreshAccounts,
    isLoading,
  };

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  );
}
