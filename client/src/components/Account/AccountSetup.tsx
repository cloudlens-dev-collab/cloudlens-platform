import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Cloud, Database, Shield, Info } from 'lucide-react';

interface AccountSetupProps {
  onClose?: () => void;
}

export function AccountSetup({ onClose }: AccountSetupProps) {
  const [provider, setProvider] = useState<string>('');
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [authMethod, setAuthMethod] = useState<string>('simple');

  const queryClient = useQueryClient();

  const createAccountMutation = useMutation({
    mutationFn: async (accountData: any) => {
      const response = await apiRequest('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountData)
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      onClose?.();
    }
  });

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const accountData = {
      name: accountName,
      provider,
      accountId,
      credentials,
      status: 'active'
    };

    createAccountMutation.mutate(accountData);
  };

  const getCredentialFields = () => {
    switch (provider) {
      case 'aws':
        return [
          { key: 'accessKeyId', label: 'AWS Access Key ID', type: 'text', required: true },
          { key: 'secretAccessKey', label: 'AWS Secret Access Key', type: 'password', required: true },
          { key: 'sessionToken', label: 'AWS Session Token (if using temporary credentials)', type: 'password', required: false },
          { key: 'region', label: 'Default Region', type: 'text', placeholder: 'us-east-1', required: false },
          { key: 'roleArn', label: 'Role ARN (for cross-account access)', type: 'text', placeholder: 'arn:aws:iam::123456789012:role/RoleName', required: false }
        ];
      case 'azure':
        if (authMethod === 'simple') {
          return [
            { key: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
            { key: 'subscriptionId', label: 'Subscription ID', type: 'text', required: true }
          ];
        } else {
          return [
            { key: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
            { key: 'clientId', label: 'Client ID', type: 'text', required: true },
            { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
            { key: 'subscriptionId', label: 'Subscription ID', type: 'text', required: true }
          ];
        }
      case 'snowflake':
        return [
          { key: 'account', label: 'Account Identifier', type: 'text', required: true },
          { key: 'username', label: 'Username', type: 'text', required: true },
          { key: 'password', label: 'Password', type: 'password', required: true },
          { key: 'warehouse', label: 'Warehouse', type: 'text', required: false },
          { key: 'database', label: 'Database', type: 'text', required: false }
        ];
      default:
        return [];
    }
  };

  const getProviderInfo = () => {
    switch (provider) {
      case 'aws':
        return {
          icon: Cloud,
          description: 'Connect to Amazon Web Services using Access Key ID, Secret Access Key, and optional Session Token',
          permissions: ['ReadOnlyAccess (or specific: EC2ReadOnly, RDSReadOnly, S3ReadOnly, CostExplorerReadOnly)']
        };
      case 'azure':
        return {
          icon: Cloud,
          description: 'Connect to Microsoft Azure for compute, storage, and cost data',
          permissions: ['Reader', 'Cost Management Reader']
        };
      case 'snowflake':
        return {
          icon: Database,
          description: 'Connect to Snowflake for data warehouse cost and usage tracking',
          permissions: ['ACCOUNTADMIN or custom role with usage access']
        };
      default:
        return { icon: Shield, description: '', permissions: [] };
    }
  };

  const providerInfo = getProviderInfo();
  const credentialFields = getCredentialFields();
  const Icon = providerInfo.icon;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Add Cloud Account
          </CardTitle>
          <CardDescription>
            Connect your cloud accounts to enable live infrastructure monitoring and cost tracking
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label htmlFor="provider">Cloud Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a cloud provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aws">Amazon Web Services (AWS)</SelectItem>
                  <SelectItem value="azure">Microsoft Azure</SelectItem>
                  <SelectItem value="snowflake">Snowflake</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {provider && (
              <>
                {/* Provider Info */}
                <Alert>
                  <Icon className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p>{providerInfo.description}</p>
                      <div>
                        <p className="font-medium">Required permissions:</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {providerInfo.permissions.map((permission) => (
                            <Badge key={permission} variant="secondary" className="text-xs">
                              {permission}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="accountName">Account Name</Label>
                    <Input
                      id="accountName"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="e.g., Production AWS"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accountId">
                      {provider === 'azure' ? 'Subscription ID' : 
                       provider === 'aws' ? 'Account ID' : 'Account Identifier'}
                    </Label>
                    <Input
                      id="accountId"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      placeholder={
                        provider === 'azure' ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' :
                        provider === 'aws' ? '123456789012' : 'orgname.region'
                      }
                      required
                    />
                  </div>
                </div>

                {/* Azure Authentication Method */}
                {provider === 'azure' && (
                  <div className="space-y-2">
                    <Label>Authentication Method</Label>
                    <Tabs value={authMethod} onValueChange={setAuthMethod}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="simple">Simple (Tenant + Subscription)</TabsTrigger>
                        <TabsTrigger value="service-principal">Service Principal</TabsTrigger>
                      </TabsList>
                      <TabsContent value="simple" className="mt-4">
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription>
                            Uses Azure CLI or managed identity authentication. Make sure you're logged in via Azure CLI or running in an Azure environment.
                          </AlertDescription>
                        </Alert>
                      </TabsContent>
                      <TabsContent value="service-principal" className="mt-4">
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription>
                            Uses explicit service principal credentials for authentication. Requires creating an app registration in Azure AD.
                          </AlertDescription>
                        </Alert>
                      </TabsContent>
                    </Tabs>
                  </div>
                )}

                {/* Credential Fields */}
                {credentialFields.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      <Label className="text-base font-medium">Credentials</Label>
                    </div>
                    <div className="grid gap-4">
                      {credentialFields.map((field) => (
                        <div key={field.key} className="space-y-2">
                          <Label htmlFor={field.key}>
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </Label>
                          <Input
                            id={field.key}
                            type={field.type}
                            value={credentials[field.key] || ''}
                            onChange={(e) => handleCredentialChange(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            required={field.required}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Submit Button */}
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createAccountMutation.isPending || !accountName || !accountId}
                  >
                    {createAccountMutation.isPending ? 'Adding Account...' : 'Add Account'}
                  </Button>
                </div>

                {createAccountMutation.error && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Failed to add account: {createAccountMutation.error.message}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}