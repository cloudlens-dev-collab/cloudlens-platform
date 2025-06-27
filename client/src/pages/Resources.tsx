import React, { useState, useEffect, useCallback } from "react";
import { Search, Filter, Download, Eye, MoreHorizontal, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, X, Server, HardDrive, Network, Shield, Clock, DollarSign } from "lucide-react";
import { FaAws, FaMicrosoft } from "react-icons/fa";
import { SiSnowflake } from "react-icons/si";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Resource } from "@/types";

export function Resources() {
  const { selectedAccount, accounts } = useAccount();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const itemsPerPage = 20;

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const accountIds = selectedAccount === "all" 
    ? accounts.map(acc => acc.id.toString())
    : [selectedAccount.id.toString()];

  const { data: resources = [], isLoading, refetch } = useQuery<Resource[]>({
    queryKey: ["/api/resources", { 
      accountIds: accountIds.join(","),
      search: debouncedSearch.trim() || undefined,
      provider: selectedProvider !== 'all' ? selectedProvider : undefined,
      type: selectedType !== 'all' ? selectedType : undefined,
      status: selectedStatus !== 'all' ? selectedStatus : undefined,
      sortBy,
      sortOrder
    }],
    enabled: accounts.length > 0,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    cacheTime: 0, // Disable caching to ensure fresh data
  });

  const syncMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return apiRequest("POST", `/api/resources/sync/${accountId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({
        title: "Resources synced",
        description: "Successfully synced resources from cloud provider",
      });
    },
    onError: () => {
      toast({
        title: "Sync failed",
        description: "Failed to sync resources from cloud provider",
        variant: "destructive",
      });
    },
  });

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "aws":
        return <FaAws className="text-orange-500 text-lg" />;
      case "azure":
        return <FaMicrosoft className="text-blue-500 text-lg" />;
      case "snowflake":
        return <SiSnowflake className="text-blue-400 text-lg" />;
      default:
        return null;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case "running":
      case "active":
      case "available":
        return "default";
      case "stopped":
      case "suspended":
      case "terminated":
        return "secondary";
      case "error":
      case "failed":
        return "destructive";
      default:
        return "outline";
    }
  };

  const formatResourceType = (type: string) => {
    return type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const getTypeBadgeColor = (type: string) => {
    const colorMap: Record<string, string> = {
      "ec2-instance": "bg-blue-100 text-blue-800",
      "rds-instance": "bg-green-100 text-green-800",
      "s3-bucket": "bg-purple-100 text-purple-800",
      "ebs-volume": "bg-yellow-100 text-yellow-800",
      "azure-vm": "bg-blue-100 text-blue-800",
      "azure-storage": "bg-purple-100 text-purple-800",
      "azure-disk": "bg-yellow-100 text-yellow-800",
      "snowflake-warehouse": "bg-blue-100 text-blue-800",
      "snowflake-database": "bg-green-100 text-green-800",
      "snowflake-storage": "bg-purple-100 text-purple-800",
    };
    return colorMap[type] || "bg-gray-100 text-gray-800";
  };



  // Paginate resources (filtering and sorting handled by backend)
  const totalPages = Math.ceil(resources.length / itemsPerPage);
  const paginatedResources = resources.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Get all unique types and statuses from unfiltered data
  const { data: allResources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources", { accountIds: accountIds.join(",") }],
    enabled: accounts.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes for dropdown options
  });

  const uniqueTypes = Array.from(new Set(allResources.map(r => r.type)));
  const uniqueStatuses = Array.from(new Set(allResources.map(r => r.status)));

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
    setCurrentPage(1);
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="w-4 h-4 text-gray-400" />;
    return sortOrder === "asc" ? 
      <ArrowUp className="w-4 h-4 text-primary" /> : 
      <ArrowDown className="w-4 h-4 text-primary" />;
  };

  const handleSyncAccount = (accountId: number) => {
    syncMutation.mutate(accountId);
  };

  const handleViewDetails = (resource: Resource) => {
    setSelectedResource(resource);
    setIsDetailsOpen(true);
  };

  const formatMetadataValue = (key: string, value: any): React.ReactNode => {
    if (value === null || value === undefined) return "N/A";
    
    if (typeof value === "object") {
      if (Array.isArray(value)) {
        return (
          <div className="space-y-1">
            {value.map((item, index) => (
              <div key={index} className="text-xs bg-gray-100 rounded px-2 py-1">
                {typeof item === "object" ? JSON.stringify(item, null, 2) : String(item)}
              </div>
            ))}
          </div>
        );
      }
      return (
        <pre className="text-xs bg-gray-100 rounded p-2 overflow-x-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
    }
    
    if (key.toLowerCase().includes("date") || key.toLowerCase().includes("time")) {
      try {
        return new Date(value).toLocaleString();
      } catch {
        return String(value);
      }
    }
    
    if (key.toLowerCase().includes("size") && typeof value === "number") {
      return `${value} GB`;
    }
    
    if (key.toLowerCase().includes("iops") && typeof value === "number") {
      return `${value.toLocaleString()} IOPS`;
    }
    
    if (key.toLowerCase().includes("throughput") && typeof value === "number") {
      return `${value} MB/s`;
    }
    
    if (key.toLowerCase().includes("bandwidth") && typeof value === "number") {
      return `${value} Mbps`;
    }
    
    return String(value);
  };

  const getResourceIcon = (type: string) => {
    switch (type) {
      case "ec2-instance":
        return <Server className="w-5 h-5 text-blue-600" />;
      case "ebs-volume":
        return <HardDrive className="w-5 h-5 text-yellow-600" />;
      case "s3-bucket":
        return <HardDrive className="w-5 h-5 text-green-600" />;
      case "rds-instance":
        return <HardDrive className="w-5 h-5 text-purple-600" />;
      case "load-balancer":
        return <Network className="w-5 h-5 text-orange-600" />;
      case "security-group":
        return <Shield className="w-5 h-5 text-red-600" />;
      default:
        return <Server className="w-5 h-5 text-gray-600" />;
    }
  };



  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedProvider, selectedType, selectedStatus, sortBy, sortOrder]);

  // Debug logging
  useEffect(() => {
    console.log("🔍 Resources Debug:", {
      count: resources.length,
      selectedProvider,
      selectedType,
      selectedStatus,
      sortBy,
      sortOrder,
      sampleCosts: resources.slice(0, 5).map(r => ({ name: r.name, cost: r.monthlyCost, type: r.type })),
      queryKey: ["/api/resources", { 
        accountIds: accountIds.join(","),
        search: debouncedSearch.trim() || undefined,
        provider: selectedProvider !== 'all' ? selectedProvider : undefined,
        type: selectedType !== 'all' ? selectedType : undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        sortBy,
        sortOrder
      }]
    });
    
    if (sortBy === 'monthlyCost') {
      console.log("💰 Cost sorting active:", {
        sortBy,
        sortOrder,
        firstFewCosts: resources.slice(0, 10).map(r => ({ 
          name: r.name, 
          cost: r.monthlyCost,
          costAsNumber: r.monthlyCost ? parseFloat(r.monthlyCost) : 0
        }))
      });
    }
  }, [resources, selectedProvider, selectedType, selectedStatus, sortBy, sortOrder, accountIds, debouncedSearch]);

  return (
    <div className="p-6">
      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center space-y-4 lg:space-y-0 lg:space-x-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search resources by name, type, region, or metadata..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex space-x-3">
              <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  <SelectItem value="aws">AWS</SelectItem>
                  <SelectItem value="azure">Azure</SelectItem>
                  <SelectItem value="snowflake">Snowflake</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {uniqueTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {formatResourceType(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {uniqueStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resources Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg font-semibold">Resource Inventory</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Showing {paginatedResources.length} of {resources.length} resources
              {sortBy !== 'name' && (
                <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  Sorted by {sortBy} ({sortOrder})
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading resources...</p>
            </div>
          ) : paginatedResources.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Search className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No resources found</p>
              <p className="text-sm">Try adjusting your search criteria or sync your accounts</p>
            </div>
          ) : (
            <>
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
                        <span>Cost (Month-to-Date)</span>
                        {getSortIcon('monthlyCost')}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="flex items-center space-x-1 hover:text-primary font-medium"
                        onClick={() => handleSort('region')}
                      >
                        <span>Region</span>
                        {getSortIcon('region')}
                      </button>
                    </TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedResources.map((resource) => {
                    const account = accounts.find(acc => acc.id === resource.accountId);
                    return (
                      <TableRow key={resource.id}>
                        <TableCell>
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                              {getProviderIcon(resource.provider)}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{resource.name}</div>
                              <div className="text-sm text-gray-500 font-mono text-xs">
                                {resource.resourceId.length > 30 ? 
                                  `${resource.resourceId.substring(0, 30)}...` : 
                                  resource.resourceId
                                }
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {getProviderIcon(resource.provider)}
                            <span className="text-sm">{resource.provider.toUpperCase()}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getTypeBadgeColor(resource.type)}>
                            {formatResourceType(resource.type)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(resource.status)}>
                            <div className="w-1.5 h-1.5 bg-current rounded-full mr-1"></div>
                            {resource.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {resource.monthlyCost ? `$${resource.monthlyCost}` : (
                            <span className="text-gray-400 italic">No cost data</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {resource.region || "Global"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleViewDetails(resource)}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              {account && (
                                <DropdownMenuItem
                                  onClick={() => handleSyncAccount(account.id)}
                                  disabled={syncMutation.isPending}
                                >
                                  <RefreshCw className="w-4 h-4 mr-2" />
                                  Sync Account
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-700">
                      Showing{" "}
                      <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span>{" "}
                      to{" "}
                      <span className="font-medium">
                        {Math.min(currentPage * itemsPerPage, resources.length)}
                      </span>{" "}
                      of <span className="font-medium">{resources.length}</span> results
                    </p>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const page = Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i;
                        return (
                          <Button
                            key={page}
                            variant={currentPage === page ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCurrentPage(page)}
                          >
                            {page}
                          </Button>
                        );
                      })}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Resource Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-3">
              {selectedResource && getResourceIcon(selectedResource.type)}
              <div>
                <div className="font-semibold">{selectedResource?.name}</div>
                <div className="text-sm text-gray-500 font-normal">
                  {selectedResource && formatResourceType(selectedResource.type)}
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          
          {selectedResource && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <Server className="w-5 h-5 mr-2" />
                    Basic Information
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-500">Resource ID</label>
                      <p className="font-mono text-sm bg-gray-100 rounded p-2 break-all">
                        {selectedResource.resourceId}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Provider</label>
                      <div className="flex items-center space-x-2 mt-1">
                        {getProviderIcon(selectedResource.provider)}
                        <span className="font-medium">{selectedResource.provider.toUpperCase()}</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Status</label>
                      <div className="mt-1">
                        <Badge variant={getStatusBadgeVariant(selectedResource.status)}>
                          <div className="w-1.5 h-1.5 bg-current rounded-full mr-1"></div>
                          {selectedResource.status}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Region</label>
                      <p className="font-medium">{selectedResource.region || "Global"}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Cost (Month-to-Date)</label>
                      <div className="flex items-center space-x-1">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        {selectedResource.monthlyCost ? (
                          <span className="font-semibold text-green-600">
                            ${selectedResource.monthlyCost}
                          </span>
                        ) : (
                          <span className="font-semibold text-gray-400 italic">
                            No cost data
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Accrued costs from start of current month to today
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Last Updated</label>
                      <div className="flex items-center space-x-1">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <span>{new Date(selectedResource.lastUpdated).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Performance & Technical Details */}
                {selectedResource.metadata && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center">
                      <HardDrive className="w-5 h-5 mr-2" />
                      Performance & Technical Details
                    </h3>
                    
                    {/* Performance Metrics for EBS Volumes */}
                    {selectedResource.type === "ebs-volume" && selectedResource.metadata && (
                      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-semibold text-blue-900 mb-2 flex items-center">
                          <HardDrive className="w-4 h-4 mr-2" />
                          Storage Performance
                        </h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {(selectedResource.metadata as any).iops && (
                            <div>
                              <span className="text-gray-600">IOPS:</span>
                              <span className="ml-2 font-medium text-blue-700">
                                {((selectedResource.metadata as any).iops).toLocaleString()} IOPS
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).throughput && (
                            <div>
                              <span className="text-gray-600">Calculated Throughput:</span>
                              <span className="ml-2 font-medium text-blue-700">
                                {Math.round((selectedResource.metadata as any).throughput)} MB/s
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).size && (
                            <div>
                              <span className="text-gray-600">Size:</span>
                              <span className="ml-2 font-medium text-blue-700">
                                {(selectedResource.metadata as any).size} GB
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).volumeType && (
                            <div>
                              <span className="text-gray-600">Volume Type:</span>
                              <span className="ml-2 font-medium text-blue-700 uppercase">
                                {(selectedResource.metadata as any).volumeType}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Performance Metrics for EC2 Instances */}
                    {selectedResource.type === "ec2-instance" && selectedResource.metadata && (
                      <div className="mb-4 p-4 bg-green-50 rounded-lg">
                        <h4 className="font-semibold text-green-900 mb-2 flex items-center">
                          <Server className="w-4 h-4 mr-2" />
                          Instance Performance
                        </h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {(selectedResource.metadata as any).instanceType && (
                            <div>
                              <span className="text-gray-600">Instance Type:</span>
                              <span className="ml-2 font-medium text-green-700">
                                {(selectedResource.metadata as any).instanceType}
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).vcpus && (selectedResource.metadata as any).vcpus !== 'Unknown' && (
                            <div>
                              <span className="text-gray-600">vCPUs:</span>
                              <span className="ml-2 font-medium text-green-700">
                                {(selectedResource.metadata as any).vcpus} cores
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).memory && (selectedResource.metadata as any).memory !== 'Unknown' && (
                            <div>
                              <span className="text-gray-600">Memory:</span>
                              <span className="ml-2 font-medium text-green-700">
                                {(selectedResource.metadata as any).memory} GB
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).networkPerformance && (selectedResource.metadata as any).networkPerformance !== 'Unknown' && (
                            <div>
                              <span className="text-gray-600">Network Performance:</span>
                              <span className="ml-2 font-medium text-green-700">
                                {(selectedResource.metadata as any).networkPerformance}
                              </span>
                            </div>
                          )}
                          {(selectedResource.metadata as any).ebsOptimized !== undefined && (
                            <div>
                              <span className="text-gray-600">EBS Optimized:</span>
                              <span className="ml-2 font-medium text-green-700">
                                {(selectedResource.metadata as any).ebsOptimized ? "Yes" : "No"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* All Technical Details */}
                    <div className="space-y-3">
                      {Object.entries(selectedResource.metadata as Record<string, any>).map(([key, value]) => (
                        <div key={key} className="grid grid-cols-3 gap-4">
                          <div className="font-medium text-gray-700 capitalize">
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                          </div>
                          <div className="col-span-2">
                            {formatMetadataValue(key, value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Account Information */}
                <Separator />
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <Shield className="w-5 h-5 mr-2" />
                    Account Information
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-500">Account</label>
                      <p className="font-medium">
                        {accounts.find(acc => acc.id === selectedResource.accountId)?.name || 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Account ID</label>
                      <p className="font-mono text-sm">{selectedResource.accountId}</p>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
