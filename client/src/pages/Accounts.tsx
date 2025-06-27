import React, { useState } from "react";
import { Plus, RefreshCw, Settings, Trash2, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { FaAws, FaMicrosoft } from "react-icons/fa";
import { SiSnowflake } from "react-icons/si";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/contexts/AccountContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Account } from "@/types";

export function Accounts() {
  const { accounts, refreshAccounts } = useAccount();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isEditAccountOpen, setIsEditAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [newAccountData, setNewAccountData] = useState({
    name: "",
    provider: "" as "aws" | "azure" | "snowflake" | "",
    accountId: "",
    credentials: {} as Record<string, any>,
  });
  const [editAccountData, setEditAccountData] = useState({
    name: "",
    provider: "" as "aws" | "azure" | "snowflake" | "",
    accountId: "",
    credentials: {} as Record<string, any>,
  });

  const addAccountMutation = useMutation({
    mutationFn: async (accountData: any) => {
      return apiRequest("POST", "/api/accounts", accountData);
    },
    onSuccess: () => {
      setIsAddAccountOpen(false);
      setNewAccountData({ name: "", provider: "", accountId: "", credentials: {} });
      refreshAccounts();
      toast({
        title: "Account added",
        description: "Successfully connected your cloud account",
      });
    },
    onError: () => {
      toast({
        title: "Failed to add account",
        description: "Please check your credentials and try again",
        variant: "destructive",
      });
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: async ({ id, accountData }: { id: number; accountData: any }) => {
      return apiRequest("PUT", `/api/accounts/${id}`, accountData);
    },
    onSuccess: () => {
      setIsEditAccountOpen(false);
      setEditingAccount(null);
      setEditAccountData({ name: "", provider: "", accountId: "", credentials: {} });
      refreshAccounts();
      toast({
        title: "Account updated",
        description: "Successfully updated your cloud account credentials",
      });
    },
    onError: () => {
      toast({
        title: "Failed to update account",
        description: "Please check your credentials and try again",
        variant: "destructive",
      });
    },
  });

  const syncAccountMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return apiRequest("POST", `/api/resources/sync/${accountId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({
        title: "Account synced",
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

  const deleteAccountMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return apiRequest("DELETE", `/api/accounts/${accountId}`);
    },
    onSuccess: () => {
      refreshAccounts();
      toast({
        title: "Account deleted",
        description: "Account and associated resources have been removed",
      });
    },
    onError: () => {
      toast({
        title: "Failed to delete account",
        description: "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setEditAccountData({
      name: account.name,
      provider: account.provider as "aws" | "azure" | "snowflake",
      accountId: account.accountId,
      credentials: account.credentials || {},
    });
    setIsEditAccountOpen(true);
  };

  const handleUpdateAccount = () => {
    if (!editingAccount) return;
    updateAccountMutation.mutate({
      id: editingAccount.id,
      accountData: editAccountData,
    });
  };

  const getProviderIcon = (provider: string, size = "text-xl") => {
    switch (provider) {
      case "aws":
        return <FaAws className={`text-orange-600 ${size}`} />;
      case "azure":
        return <FaMicrosoft className={`text-blue-600 ${size}`} />;
      case "snowflake":
        return <SiSnowflake className={`text-blue-400 ${size}`} />;
      default:
        return null;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "inactive":
        return <Clock className="w-5 h-5 text-gray-400" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "inactive":
        return "text-gray-600";
      default:
        return "text-yellow-600";
    }
  };

  const handleAddAccount = () => {
    if (!newAccountData.name || !newAccountData.provider || !newAccountData.accountId) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    addAccountMutation.mutate({
      ...newAccountData,
      status: "active",
    });
  };

  const renderCredentialsForm = () => {
    switch (newAccountData.provider) {
      case "aws":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="roleArn">Role ARN</Label>
              <Input
                id="roleArn"
                placeholder="arn:aws:iam::123456789012:role/AstraeusRole"
                value={newAccountData.credentials.roleArn || ""}
                onChange={(e) => setNewAccountData({
                  ...newAccountData,
                  credentials: { ...newAccountData.credentials, roleArn: e.target.value }
                })}
              />
            </div>
            <div>
              <Label htmlFor="externalId">External ID (Optional)</Label>
              <Input
                id="externalId"
                placeholder="unique-external-id"
                value={newAccountData.credentials.externalId || ""}
                onChange={(e) => setNewAccountData({
                  ...newAccountData,
                  credentials: { ...newAccountData.credentials, externalId: e.target.value }
                })}
              />
            </div>
          </div>
        );
      case "azure":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="subscriptionId">Subscription ID</Label>
              <Input
                id="subscriptionId"
                placeholder="12345678-1234-1234-1234-123456789012"
                value={newAccountData.credentials.subscriptionId || ""}
                onChange={(e) => setNewAccountData({
                  ...newAccountData,
                  credentials: { ...newAccountData.credentials, subscriptionId: e.target.value }
                })}
              />
            </div>
            <div>
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                id="clientId"
                placeholder="application-client-id"
                value={newAccountData.credentials.clientId || ""}
                onChange={(e) => setNewAccountData({
                  ...newAccountData,
                  credentials: { ...newAccountData.credentials, clientId: e.target.value }
                })}
              />
            </div>
          </div>
        );
      case "snowflake":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="account">Account Identifier</Label>
              <Input
                id="account"
                placeholder="PROD.ANALYTICS"
                value={newAccountData.credentials.account || ""}
                onChange={(e) => setNewAccountData({
                  ...newAccountData,
                  credentials: { ...newAccountData.credentials, account: e.target.value }
                })}
              />
            </div>
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="astraeus_user"
                value={newAccountData.credentials.username || ""}
                onChange={(e) => setNewAccountData({
                  ...newAccountData,
                  credentials: { ...newAccountData.credentials, username: e.target.value }
                })}
              />
            </div>
          </div>
        );
      default:
        return <p className="text-sm text-gray-500">Select a provider to configure credentials</p>;
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Account Management</h2>
          <p className="text-gray-600 mt-1">
            Manage your cloud provider connections and account configurations
          </p>
        </div>
        <Dialog open={isAddAccountOpen} onOpenChange={setIsAddAccountOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Cloud Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="name">Account Name</Label>
                <Input
                  id="name"
                  placeholder="Production AWS"
                  value={newAccountData.name}
                  onChange={(e) => setNewAccountData({ ...newAccountData, name: e.target.value })}
                />
              </div>
              
              <div>
                <Label htmlFor="provider">Provider</Label>
                <Select
                  value={newAccountData.provider}
                  onValueChange={(value: "aws" | "azure" | "snowflake") => 
                    setNewAccountData({ ...newAccountData, provider: value, credentials: {} })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aws">AWS</SelectItem>
                    <SelectItem value="azure">Azure</SelectItem>
                    <SelectItem value="snowflake">Snowflake</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="accountId">Account ID</Label>
                <Input
                  id="accountId"
                  placeholder={
                    newAccountData.provider === "aws" ? "123456789012" :
                    newAccountData.provider === "azure" ? "abc-def-123-456" :
                    "PROD.ANALYTICS"
                  }
                  value={newAccountData.accountId}
                  onChange={(e) => setNewAccountData({ ...newAccountData, accountId: e.target.value })}
                />
              </div>

              {renderCredentialsForm()}

              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setIsAddAccountOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddAccount}
                  disabled={addAccountMutation.isPending}
                >
                  {addAccountMutation.isPending ? "Adding..." : "Add Account"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Connected Accounts */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {accounts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Settings className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No accounts connected</p>
              <p className="text-sm">Connect your first cloud account to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {accounts.map((account) => (
                <div key={account.id} className="p-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                        {getProviderIcon(account.provider)}
                      </div>
                      <div>
                        <h4 className="text-lg font-medium text-gray-900">{account.name}</h4>
                        <p className="text-sm text-gray-600">Account ID: {account.accountId}</p>
                        {account.provider === "aws" && account.credentials.roleArn && (
                          <p className="text-sm text-gray-600">
                            Role: {(account.credentials as any).roleArn.split("/").pop()}
                          </p>
                        )}
                        {account.provider === "azure" && account.credentials.subscriptionId && (
                          <p className="text-sm text-gray-600">
                            Subscription: {(account.credentials as any).subscriptionId}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(account.status)}
                          <span className={`text-sm font-medium ${getStatusColor(account.status)}`}>
                            {account.status === "active" ? "Active" : 
                             account.status === "error" ? "Error" : 
                             "Inactive"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Last sync: {account.lastSyncAt 
                            ? new Date(account.lastSyncAt).toLocaleString()
                            : "Never"
                          }
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncAccountMutation.mutate(account.id)}
                          disabled={syncAccountMutation.isPending}
                        >
                          <RefreshCw className={`w-4 h-4 ${syncAccountMutation.isPending ? "animate-spin" : ""}`} />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Settings className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.preventDefault();
                                console.log('Edit credentials clicked for account:', account.id);
                                handleEditAccount(account);
                              }}
                            >
                              <Settings className="w-4 h-4 mr-2" />
                              Edit Credentials
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => deleteAccountMutation.mutate(account.id)}
                              disabled={deleteAccountMutation.isPending}
                              className="text-red-600"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Account
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteAccountMutation.mutate(account.id)}
                          disabled={deleteAccountMutation.isPending}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add New Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="hover:border-primary hover:shadow-md transition-all cursor-pointer">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              {getProviderIcon("aws", "text-2xl")}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect AWS</h3>
            <p className="text-sm text-gray-600 mb-4">
              Connect your AWS account using cross-account roles for secure access to EC2, RDS, S3, and billing data.
            </p>
            <Button 
              className="w-full bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                setNewAccountData({ ...newAccountData, provider: "aws" });
                setIsAddAccountOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add AWS Account
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary hover:shadow-md transition-all cursor-pointer">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              {getProviderIcon("azure", "text-2xl")}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect Azure</h3>
            <p className="text-sm text-gray-600 mb-4">
              Connect your Azure subscription to monitor VMs, storage accounts, and resource costs.
            </p>
            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                setNewAccountData({ ...newAccountData, provider: "azure" });
                setIsAddAccountOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Azure Account
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary hover:shadow-md transition-all cursor-pointer">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              {getProviderIcon("snowflake", "text-2xl")}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect Snowflake</h3>
            <p className="text-sm text-gray-600 mb-4">
              Connect your Snowflake account to monitor warehouse usage, query performance, and costs.
            </p>
            <Button 
              className="w-full bg-blue-400 hover:bg-blue-500"
              onClick={() => {
                setNewAccountData({ ...newAccountData, provider: "snowflake" });
                setIsAddAccountOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Snowflake Account
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Edit Account Dialog */}
      <Dialog open={isEditAccountOpen} onOpenChange={setIsEditAccountOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Account Credentials</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Account Name</Label>
              <Input
                id="edit-name"
                value={editAccountData.name}
                onChange={(e) => setEditAccountData({ ...editAccountData, name: e.target.value })}
                placeholder="My AWS Account"
              />
            </div>

            <div>
              <Label htmlFor="edit-accountId">Account ID</Label>
              <Input
                id="edit-accountId"
                value={editAccountData.accountId}
                onChange={(e) => setEditAccountData({ ...editAccountData, accountId: e.target.value })}
                placeholder="123456789012"
              />
            </div>

            {editAccountData.provider === "aws" && (
              <>
                <div>
                  <Label htmlFor="edit-accessKeyId">Access Key ID</Label>
                  <Input
                    id="edit-accessKeyId"
                    type="password"
                    value={editAccountData.credentials.accessKeyId || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, accessKeyId: e.target.value }
                    })}
                    placeholder="AKIA..."
                  />
                </div>
                <div>
                  <Label htmlFor="edit-secretAccessKey">Secret Access Key</Label>
                  <Input
                    id="edit-secretAccessKey"
                    type="password"
                    value={editAccountData.credentials.secretAccessKey || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, secretAccessKey: e.target.value }
                    })}
                    placeholder="***"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-sessionToken">Session Token (Optional)</Label>
                  <Input
                    id="edit-sessionToken"
                    type="password"
                    value={editAccountData.credentials.sessionToken || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, sessionToken: e.target.value }
                    })}
                    placeholder="Session token for temporary credentials"
                  />
                </div>
              </>
            )}

            {editAccountData.provider === "azure" && (
              <>
                <div>
                  <Label htmlFor="edit-clientId">Client ID</Label>
                  <Input
                    id="edit-clientId"
                    type="password"
                    value={editAccountData.credentials.clientId || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, clientId: e.target.value }
                    })}
                    placeholder="Client ID"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-clientSecret">Client Secret</Label>
                  <Input
                    id="edit-clientSecret"
                    type="password"
                    value={editAccountData.credentials.clientSecret || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, clientSecret: e.target.value }
                    })}
                    placeholder="***"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-tenantId">Tenant ID</Label>
                  <Input
                    id="edit-tenantId"
                    value={editAccountData.credentials.tenantId || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, tenantId: e.target.value }
                    })}
                    placeholder="Tenant ID"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-subscriptionId">Subscription ID</Label>
                  <Input
                    id="edit-subscriptionId"
                    value={editAccountData.credentials.subscriptionId || ""}
                    onChange={(e) => setEditAccountData({
                      ...editAccountData,
                      credentials: { ...editAccountData.credentials, subscriptionId: e.target.value }
                    })}
                    placeholder="Subscription ID"
                  />
                </div>
              </>
            )}

            <div className="flex space-x-2 pt-4">
              <Button
                onClick={handleUpdateAccount}
                disabled={updateAccountMutation.isPending}
                className="flex-1"
              >
                {updateAccountMutation.isPending && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                Update Credentials
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditAccountOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
