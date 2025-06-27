import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountProvider } from "@/contexts/AccountContext";
import { Header } from "@/components/Layout/Header";
import { Sidebar } from "@/components/Layout/Sidebar";
import { Dashboard } from "@/pages/Dashboard";
import { Resources } from "@/pages/Resources";
import { Costs } from "@/pages/Costs";
import { Chat } from "@/pages/Chat";
import { Accounts } from "@/pages/Accounts";
import { MCPDashboard } from "@/pages/MCPDashboard";
import NotFound from "@/pages/not-found";

function Router() {
  const [location, setLocation] = useLocation();
  
  // Extract current tab from location
  const getCurrentTab = () => {
    if (location === "/" || location === "/dashboard") return "dashboard";
    if (location === "/resources") return "resources";
    if (location === "/costs") return "costs";
    if (location === "/chat") return "chat";
    if (location === "/accounts") return "accounts";
    if (location === "/mcp") return "mcp";
    return "dashboard";
  };

  const handleTabChange = (tab: string) => {
    const routes: Record<string, string> = {
      dashboard: "/",
      resources: "/resources",
      costs: "/costs",
      chat: "/chat",
      accounts: "/accounts",
      mcp: "/mcp",
    };
    setLocation(routes[tab] || "/");
  };

  const currentTab = getCurrentTab();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentTab={currentTab} />
      <div className="flex h-[calc(100vh-80px)]">
        <Sidebar activeTab={currentTab} onTabChange={handleTabChange} />
        <main className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/resources" component={Resources} />
            <Route path="/costs" component={Costs} />
            <Route path="/chat" component={Chat} />
            <Route path="/accounts" component={Accounts} />
            <Route path="/mcp" component={MCPDashboard} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AccountProvider>
          <Toaster />
          <Router />
        </AccountProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
