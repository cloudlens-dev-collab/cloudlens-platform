import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { SiMicrosoftazure } from "react-icons/si";
import { ArrowLeft } from "lucide-react";

const azureAccountSchema = z.object({
  name: z.string().min(1, "Account name is required"),
  subscriptionId: z.string().min(1, "Subscription ID is required"),
  tenantId: z.string().min(1, "Tenant ID is required"),
  description: z.string().optional(),
});

type AzureAccountForm = z.infer<typeof azureAccountSchema>;

export function AddAzureAccount() {
  const [navigate] = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<AzureAccountForm>({
    resolver: zodResolver(azureAccountSchema),
    defaultValues: {
      name: "",
      subscriptionId: "",
      tenantId: "",
      description: "",
    },
  });

  const addAccountMutation = useMutation({
    mutationFn: async (data: AzureAccountForm) => {
      return apiRequest("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          provider: "azure",
          accountId: data.subscriptionId,
          credentials: {
            subscriptionId: data.subscriptionId,
            tenantId: data.tenantId,
          },
          description: data.description,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({
        title: "Azure Account Added",
        description: "Your Azure account has been successfully configured.",
      });
      navigate("/accounts");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add Azure account. Please check your credentials.",
      });
    },
  });

  const onSubmit = (data: AzureAccountForm) => {
    addAccountMutation.mutate(data);
  };

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/accounts")}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Accounts
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <SiMicrosoftazure className="w-8 h-8 text-blue-500" />
              Add Azure Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Production Azure" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="subscriptionId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subscription ID</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tenantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tenant ID</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />



                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Description of this Azure account"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={addAccountMutation.isPending}
                >
                  {addAccountMutation.isPending ? "Adding Account..." : "Add Azure Account"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}