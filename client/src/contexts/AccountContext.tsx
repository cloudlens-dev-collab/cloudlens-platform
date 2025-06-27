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
  const [hasUserSelected, setHasUserSelected] = useState(false);
  const queryClient = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
    // Remove auto-refresh to prevent unnecessary Azure calls
  });

  const refreshAccounts = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
  };

  // Auto-select AWS account only on initial load (not when user explicitly selects "all")
  useEffect(() => {
    if (!hasUserSelected && selectedAccount === "all" && accounts.length > 0) {
      // Only auto-select on initial load, not when user manually selects "all"
      const awsAccount = accounts.find(acc => acc.provider === 'aws');
      if (awsAccount) {
        setSelectedAccount(awsAccount);
      }
    }
  }, [accounts, hasUserSelected, selectedAccount]);

  // Wrapper function to track user selections
  const handleSetSelectedAccount = (account: Account | "all") => {
    setHasUserSelected(true);
    setSelectedAccount(account);
  };

  const value: AccountContextType = {
    selectedAccount,
    accounts,
    setSelectedAccount: handleSetSelectedAccount,
    refreshAccounts,
    isLoading,
  };

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  );
}
