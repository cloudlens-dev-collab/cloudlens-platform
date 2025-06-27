import React, { useState, useMemo } from "react";
import { 
  Search, Filter, Download, Eye, MoreHorizontal, RefreshCw, 
  ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown,
  DollarSign, Clock, AlertTriangle, CheckCircle, XCircle,
  Zap, Database, Server, HardDrive, Cloud, Shield,
  BarChart3, PieChart, Activity, Settings
} from "lucide-react";
import { FaAws, FaMicrosoft, FaGoogle } from "react-icons/fa";
import { SiSnowflake } from "react-icons/si";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import type { Resource } from "@/types";

interface EnhancedResourceTableProps {
  resources: Resource[];
  accounts: any[];
  onViewDetails: (resource: Resource) => void;
  onSyncAccount: (accountId: number) => void;
  isLoading?: boolean;
  isSyncing?: boolean;
}

export function EnhancedResourceTable({
  resources,
  accounts,
  onViewDetails,
  onSyncAccount,
  isLoading = false,
  isSyncing = false
}: EnhancedResourceTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [costFilter, setCostFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("monthlyCost");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  // Advanced filtering and analytics
  const filteredAndSortedResources = useMemo(() => {
    let filtered = resources.filter(resource => {
      // Search filter
      if (searchQuery) {
        const search = searchQuery.toLowerCase();
        if (!resource.name?.toLowerCase().includes(search) && 
            !resource.resourceId?.toLowerCase().includes(search) &&
            !resource.type?.toLowerCase().includes(search)) {
          return false;
        }
      }
      
      // Provider filter
      if (selectedProvider !== "all" && resource.provider !== selectedProvider) {
        return false;
      }
      
      // Type filter
      if (selectedType !== "all" && resource.type !== selectedType) {
        return false;
      }
      
      // Status filter
      if (selectedStatus !== "all" && resource.status !== selectedStatus) {
        return false;
      }
      
      // Cost filter
      if (costFilter !== "all") {
        const cost = parseFloat(resource.monthlyCost || "0");
        switch (costFilter) {
          case "high": return cost > 100;
          case "medium": return cost >= 10 && cost <= 100;
          case "low": return cost > 0 && cost < 10;
          case "zero": return cost === 0;
          default: return true;
        }
      }
      
      return true;
    });

    // Sort resources
    filtered.sort((a, b) => {
      let aValue: any = a[sortBy as keyof typeof a];
      let bValue: any = b[sortBy as keyof typeof b];
      
      if (aValue == null) aValue = sortBy === 'monthlyCost' ? 0 : '';
      if (bValue == null) bValue = sortBy === 'monthlyCost' ? 0 : '';
      
      if (sortBy === 'monthlyCost') {
        const aNum = parseFloat(String(aValue)) || 0;
        const bNum = parseFloat(String(bValue)) || 0;
        const comparison = aNum - bNum;
        return sortOrder === 'desc' ? -comparison : comparison;
      }
      
      const comparison = String(aValue).localeCompare(String(bValue));
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return filtered;
  }, [resources, searchQuery, selectedProvider, selectedType, selectedStatus, costFilter, sortBy, sortOrder]);

  // Analytics calculations
  const analytics = useMemo(() => {
    const totalCost = filteredAndSortedResources.reduce((sum, r) => sum + (parseFloat(r.monthlyCost || "0")), 0);
    const activeResources = filteredAndSortedResources.filter(r => ["running", "active"].includes(r.status));
    const stoppedResources = filteredAndSortedResources.filter(r => ["stopped", "inactive"].includes(r.status));
    const potentialSavings = stoppedResources.reduce((sum, r) => sum + (parseFloat(r.monthlyCost || "0")), 0);
    
    // Cost distribution by provider
    const providerCosts: Record<string, number> = {};
    filteredAndSortedResources.forEach(r => {
      const cost = parseFloat(r.monthlyCost || "0");
      providerCosts[r.provider] = (providerCosts[r.provider] || 0) + cost;
    });

    // Resource type distribution
    const typeCounts: Record<string, number> = {};
    filteredAndSortedResources.forEach(r => {
      typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
    });

    return {
      totalCost,
      activeResources: activeResources.length,
      stoppedResources: stoppedResources.length,
      potentialSavings,
      providerCosts,
      typeCounts,
      avgCostPerResource: totalCost / filteredAndSortedResources.length || 0
    };
  }, [filteredAndSortedResources]);

  const getProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case "aws": return <FaAws className="w-4 h-4 text-orange-500" />;
      case "azure": return <FaMicrosoft className="w-4 h-4 text-blue-500" />;
      case "gcp": return <FaGoogle className="w-4 h-4 text-green-500" />;
      case "snowflake": return <SiSnowflake className="w-4 h-4 text-blue-400" />;
      default: return <Cloud className="w-4 h-4 text-gray-500" />;
    }
  };

  const getResourceIcon = (type: string) => {
    if (type.includes("ec2") || type.includes("vm")) return <Server className="w-4 h-4" />;
    if (type.includes("rds") || type.includes("database")) return <Database className="w-4 h-4" />;
    if (type.includes("s3") || type.includes("storage") || type.includes("disk")) return <HardDrive className="w-4 h-4" />;
    if (type.includes("lambda") || type.includes("function")) return <Zap className="w-4 h-4" />;
    if (type.includes("security") || type.includes("firewall")) return <Shield className="w-4 h-4" />;
    return <Cloud className="w-4 h-4" />;
  };

  const getStatusBadge = (status: string, cost: string | null) => {
    const costNum = parseFloat(cost || "0");
    const isWasteful = ["stopped", "inactive"].includes(status) && costNum > 0;
    
    if (isWasteful) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="w-3 h-3" />
          {status} - ${costNum.toFixed(2)}/mo waste
        </Badge>
      );
    }
    
    switch (status) {
      case "running":
      case "active":
        return (
          <Badge variant="default" className="gap-1 bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3" />
            {status}
          </Badge>
        );
      case "stopped":
      case "inactive":
        return (
          <Badge variant="secondary" className="gap-1">
            <XCircle className="w-3 h-3" />
            {status}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getCostTrendIcon = (cost: string | null) => {
    const costNum = parseFloat(cost || "0");
    if (costNum > 100) return <TrendingUp className="w-4 h-4 text-red-500" />;
    if (costNum > 10) return <TrendingUp className="w-4 h-4 text-yellow-500" />;
    if (costNum > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    return null;
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="w-4 h-4 text-gray-400" />;
    return sortOrder === "asc" ? 
      <ArrowUp className="w-4 h-4 text-primary" /> : 
      <ArrowDown className="w-4 h-4 text-primary" />;
  };

  const exportData = () => {
    const csv = [
      ["Resource Name", "Type", "Provider", "Status", "Region", "Monthly Cost", "Account"].join(","),
      ...filteredAndSortedResources.map(resource => [
        resource.name,
        resource.type,
        resource.provider,
        resource.status,
        resource.region || "Global",
        resource.monthlyCost || "0",
        accounts.find(acc => acc.id === resource.accountId)?.name || "Unknown"
      ].join(","))
    ].join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resources-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Analytics Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Monthly Cost</p>
                <p className="text-2xl font-bold text-green-600">
                  ${analytics.totalCost.toFixed(2)}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Active Resources</p>
                <p className="text-2xl font-bold text-blue-600">
                  {analytics.activeResources}
                </p>
              </div>
              <Activity className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Potential Savings</p>
                <p className="text-2xl font-bold text-red-600">
                  ${analytics.potentialSavings.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">
                  {analytics.stoppedResources} stopped resources
                </p>
              </div>
              <Settings className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Avg Cost/Resource</p>
                <p className="text-2xl font-bold text-purple-600">
                  ${analytics.avgCostPerResource.toFixed(2)}
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Controls */}
      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Cloud Resources
                <Badge variant="outline">{filteredAndSortedResources.length}</Badge>
              </CardTitle>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportData}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setViewMode(viewMode === "table" ? "grid" : "table")}
              >
                {viewMode === "table" ? <PieChart className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search resources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                <SelectItem value="aws">AWS</SelectItem>
                <SelectItem value="azure">Azure</SelectItem>
                <SelectItem value="gcp">Google Cloud</SelectItem>
                <SelectItem value="snowflake">Snowflake</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {Object.keys(analytics.typeCounts).map(type => (
                  <SelectItem key={type} value={type}>
                    {type} ({analytics.typeCounts[type]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={costFilter} onValueChange={setCostFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Cost Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Costs</SelectItem>
                <SelectItem value="high">High (&gt;$100)</SelectItem>
                <SelectItem value="medium">Medium ($10-$100)</SelectItem>
                <SelectItem value="low">Low (&lt;$10)</SelectItem>
                <SelectItem value="zero">No Cost ($0)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading resources...</p>
            </div>
          ) : filteredAndSortedResources.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Search className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No resources found</p>
              <p className="text-sm">Try adjusting your filters or sync your accounts</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      className="flex items-center space-x-1 hover:text-primary font-medium"
                      onClick={() => handleSort('name')}
                    >
                      <span>Resource</span>
                      {getSortIcon('name')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      className="flex items-center space-x-1 hover:text-primary font-medium"
                      onClick={() => handleSort('provider')}
                    >
                      <span>Provider</span>
                      {getSortIcon('provider')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      className="flex items-center space-x-1 hover:text-primary font-medium"
                      onClick={() => handleSort('type')}
                    >
                      <span>Type</span>
                      {getSortIcon('type')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      className="flex items-center space-x-1 hover:text-primary font-medium"
                      onClick={() => handleSort('status')}
                    >
                      <span>Status</span>
                      {getSortIcon('status')}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      className="flex items-center space-x-1 hover:text-primary font-medium"
                      onClick={() => handleSort('monthlyCost')}
                    >
                      <span>Monthly Cost</span>
                      {getSortIcon('monthlyCost')}
                    </button>
                  </TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedResources.map((resource) => {
                  const account = accounts.find(acc => acc.id === resource.accountId);
                  const cost = parseFloat(resource.monthlyCost || "0");
                  
                  return (
                    <TableRow key={resource.id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          {getResourceIcon(resource.type)}
                          <div>
                            <div className="font-medium">{resource.name}</div>
                            <div className="text-sm text-gray-500 font-mono">
                              {resource.resourceId}
                            </div>
                            <div className="text-xs text-gray-400">
                              {account?.name}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getProviderIcon(resource.provider)}
                          <span className="font-medium">{resource.provider.toUpperCase()}</span>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {getResourceIcon(resource.type)}
                          {resource.type}
                        </Badge>
                      </TableCell>
                      
                      <TableCell>
                        {getStatusBadge(resource.status, resource.monthlyCost || null)}
                      </TableCell>
                      
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getCostTrendIcon(resource.monthlyCost || null)}
                          <div>
                            {resource.monthlyCost ? (
                              <div className="font-semibold text-green-600">
                                ${cost.toFixed(2)}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">No cost data</span>
                            )}
                            {cost > 0 && (
                              <div className="text-xs text-gray-500">
                                ${(cost * 12).toFixed(0)}/year
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <span className="text-sm text-gray-600">
                          {resource.region || "Global"}
                        </span>
                      </TableCell>
                      
                      <TableCell>
                        <TooltipProvider>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onViewDetails(resource)}>
                                <Eye className="w-4 h-4 mr-2" />
                                View Details & Cost Breakdown
                              </DropdownMenuItem>
                              {account && (
                                <DropdownMenuItem
                                  onClick={() => onSyncAccount(account.id)}
                                  disabled={isSyncing}
                                >
                                  <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                                  Sync Account
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}