export interface Account {
  id: number;
  name: string;
  provider: "aws" | "azure" | "snowflake";
  accountId: string;
  status: "active" | "inactive" | "error";
  credentials: Record<string, any>;
  createdAt: string;
  lastSyncAt: string | null;
}

export interface Resource {
  id: number;
  accountId: number;
  resourceId: string;
  name: string;
  type: string;
  provider: "aws" | "azure" | "snowflake";
  status: string;
  region?: string;
  metadata?: Record<string, any>;
  monthlyCost?: string;
  lastUpdated: string;
}

export interface Cost {
  id: number;
  accountId: number;
  service: string;
  amount: string;
  currency: string;
  period: string;
  date: string;
}

export interface Alert {
  id: number;
  accountId?: number;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  type: "cost" | "performance" | "security";
  isRead: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  accountContext?: string;
  createdAt: string;
}

export interface DashboardSummary {
  totalCost: string;
  activeResources: number;
  alertCount: number;
  criticalAlertCount: number;
  potentialSavings: string;
  resourceBreakdown: Record<string, number>;
  costTrend: {
    current: string;
    previous: string;
    percentChange: string;
  };
}

export type LLMProvider = "openai" | "claude" | "gemini" | "perplexity";

export interface AccountContextType {
  selectedAccount: Account | "all";
  accounts: Account[];
  setSelectedAccount: (account: Account | "all") => void;
  refreshAccounts: () => void;
  isLoading: boolean;
}
