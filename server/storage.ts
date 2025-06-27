import { 
  users, accounts, resources, costs, alerts, chatMessages,
  type User, type InsertUser, type Account, type InsertAccount,
  type Resource, type InsertResource, type Cost, type InsertCost,
  type Alert, type InsertAlert, type ChatMessage, type InsertChatMessage
} from "../shared/schema";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Accounts
  getAccounts(): Promise<Account[]>;
  getAccount(id: number): Promise<Account | undefined>;
  getAccountsByProvider(provider: string): Promise<Account[]>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: number, updates: Partial<InsertAccount>): Promise<Account>;
  deleteAccount(id: number): Promise<void>;

  // Resources
  getResources(accountIds?: number[]): Promise<Resource[]>;
  getResourcesByAccount(accountId: number): Promise<Resource[]>;
  getResourcesByType(type: string, accountIds?: number[]): Promise<Resource[]>;
  createResource(resource: InsertResource): Promise<Resource>;
  updateResource(id: number, updates: Partial<InsertResource>): Promise<Resource>;
  deleteResource(id: number): Promise<void>;
  deleteResourcesByAccount(accountId: number): Promise<void>;

  // Costs
  getCosts(accountIds?: number[], startDate?: Date, endDate?: Date): Promise<Cost[]>;
  getCostsByAccount(accountId: number, startDate?: Date, endDate?: Date): Promise<Cost[]>;
  getCostTrends(accountIds?: number[], period?: string): Promise<Cost[]>;
  createCost(cost: InsertCost): Promise<Cost>;

  // Alerts
  getAlerts(accountIds?: number[]): Promise<Alert[]>;
  getUnreadAlerts(accountIds?: number[]): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertAsRead(id: number): Promise<void>;

  // Chat Messages
  getChatMessages(sessionId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  deleteChatSession(sessionId: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private accounts: Map<number, Account> = new Map();
  private resources: Map<number, Resource> = new Map();
  private costs: Map<number, Cost> = new Map();
  private alerts: Map<number, Alert> = new Map();
  private chatMessages: Map<number, ChatMessage> = new Map();
  private currentId = { users: 1, accounts: 1, resources: 1, costs: 1, alerts: 1, chatMessages: 1 };

  constructor() {
    // Initialize with some sample accounts for development
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Sample accounts
    const awsAccount: Account = {
      id: 1,
      name: "Production-AWS",
      provider: "aws",
      accountId: "123456789012",
      status: "active",
      credentials: { roleArn: "arn:aws:iam::123456789012:role/AstraeusRole" },
      createdAt: new Date(),
      lastSyncAt: new Date(),
    };

    const azureAccount: Account = {
      id: 2,
      name: "Staging-Azure",
      provider: "azure",
      accountId: "abc-def-123-456",
      status: "active",
      credentials: { subscriptionId: "abc-def-123-456", clientId: "client123" },
      createdAt: new Date(),
      lastSyncAt: new Date(),
    };

    const snowflakeAccount: Account = {
      id: 3,
      name: "Analytics-Snowflake",
      provider: "snowflake",
      accountId: "PROD.ANALYTICS",
      status: "active",
      credentials: { account: "PROD.ANALYTICS", username: "astraeus_user" },
      createdAt: new Date(),
      lastSyncAt: new Date(),
    };

    this.accounts.set(2, azureAccount);
    this.accounts.set(3, snowflakeAccount);
    this.currentId.accounts = 4;
  }

  // Users
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentId.users++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Accounts
  async getAccounts(): Promise<Account[]> {
    return Array.from(this.accounts.values());
  }

  async getAccount(id: number): Promise<Account | undefined> {
    return this.accounts.get(id);
  }

  async getAccountsByProvider(provider: string): Promise<Account[]> {
    return Array.from(this.accounts.values()).filter(account => account.provider === provider);
  }

  async createAccount(insertAccount: InsertAccount): Promise<Account> {
    const id = this.currentId.accounts++;
    const account: Account = { 
      ...insertAccount, 
      id,
      status: insertAccount.status || "active",
      createdAt: new Date(),
      lastSyncAt: null 
    };
    this.accounts.set(id, account);
    return account;
  }

  async updateAccount(id: number, updates: Partial<InsertAccount>): Promise<Account> {
    const account = this.accounts.get(id);
    if (!account) throw new Error('Account not found');
    
    const updatedAccount = { ...account, ...updates, lastSyncAt: new Date() };
    this.accounts.set(id, updatedAccount);
    return updatedAccount;
  }

  async deleteAccount(id: number): Promise<void> {
    this.accounts.delete(id);
    // Also delete related resources
    await this.deleteResourcesByAccount(id);
  }

  // Resources
  async getResources(accountIds?: number[]): Promise<Resource[]> {
    const allResources = Array.from(this.resources.values());
    if (!accountIds) return allResources;
    return allResources.filter(resource => accountIds.includes(resource.accountId));
  }

  async getResourcesByAccount(accountId: number): Promise<Resource[]> {
    return Array.from(this.resources.values()).filter(resource => resource.accountId === accountId);
  }

  async getResourcesByType(type: string, accountIds?: number[]): Promise<Resource[]> {
    let resources = Array.from(this.resources.values()).filter(resource => resource.type === type);
    if (accountIds) {
      resources = resources.filter(resource => accountIds.includes(resource.accountId));
    }
    return resources;
  }

  async createResource(insertResource: InsertResource): Promise<Resource> {
    const id = this.currentId.resources++;
    const resource: Resource = { 
      ...insertResource, 
      id,
      region: insertResource.region || null,
      metadata: insertResource.metadata || null,
      monthlyCost: insertResource.monthlyCost || null,
      lastUpdated: new Date() 
    };
    this.resources.set(id, resource);
    return resource;
  }

  async updateResource(id: number, updates: Partial<InsertResource>): Promise<Resource> {
    const resource = this.resources.get(id);
    if (!resource) throw new Error('Resource not found');
    
    const updatedResource = { ...resource, ...updates, lastUpdated: new Date() };
    this.resources.set(id, updatedResource);
    return updatedResource;
  }

  async deleteResource(id: number): Promise<void> {
    this.resources.delete(id);
  }

  async deleteResourcesByAccount(accountId: number): Promise<void> {
    const resourcesToDelete = Array.from(this.resources.entries())
      .filter(([_, resource]) => resource.accountId === accountId)
      .map(([id]) => id);
    
    resourcesToDelete.forEach(id => this.resources.delete(id));
  }

  // Costs
  async getCosts(accountIds?: number[], startDate?: Date, endDate?: Date): Promise<Cost[]> {
    let costs = Array.from(this.costs.values());
    
    if (accountIds) {
      costs = costs.filter(cost => accountIds.includes(cost.accountId));
    }
    
    if (startDate) {
      costs = costs.filter(cost => new Date(cost.date) >= startDate);
    }
    
    if (endDate) {
      costs = costs.filter(cost => new Date(cost.date) <= endDate);
    }
    
    return costs;
  }

  async getCostsByAccount(accountId: number, startDate?: Date, endDate?: Date): Promise<Cost[]> {
    return this.getCosts([accountId], startDate, endDate);
  }

  async getCostTrends(accountIds?: number[], period = 'monthly'): Promise<Cost[]> {
    return this.getCosts(accountIds);
  }

  async createCost(insertCost: InsertCost): Promise<Cost> {
    const id = this.currentId.costs++;
    const cost: Cost = { 
      ...insertCost, 
      id,
      currency: insertCost.currency || "USD"
    };
    this.costs.set(id, cost);
    return cost;
  }

  // Alerts
  async getAlerts(accountIds?: number[]): Promise<Alert[]> {
    let alerts = Array.from(this.alerts.values());
    if (accountIds) {
      alerts = alerts.filter(alert => !alert.accountId || accountIds.includes(alert.accountId));
    }
    return alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getUnreadAlerts(accountIds?: number[]): Promise<Alert[]> {
    const alerts = await this.getAlerts(accountIds);
    return alerts.filter(alert => !alert.isRead);
  }

  async createAlert(insertAlert: InsertAlert): Promise<Alert> {
    const id = this.currentId.alerts++;
    const alert: Alert = { 
      ...insertAlert, 
      id,
      accountId: insertAlert.accountId ?? null,
      isRead: insertAlert.isRead ?? false,
      createdAt: new Date() 
    };
    this.alerts.set(id, alert);
    return alert;
  }

  async markAlertAsRead(id: number): Promise<void> {
    const alert = this.alerts.get(id);
    if (alert) {
      this.alerts.set(id, { ...alert, isRead: true });
    }
  }

  // Chat Messages
  async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return Array.from(this.chatMessages.values())
      .filter(message => message.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async createChatMessage(insertMessage: InsertChatMessage): Promise<ChatMessage> {
    const id = this.currentId.chatMessages++;
    const message: ChatMessage = { 
      ...insertMessage, 
      id,
      model: insertMessage.model ?? null,
      accountContext: insertMessage.accountContext ?? null,
      createdAt: new Date() 
    };
    this.chatMessages.set(id, message);
    return message;
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    const messagesToDelete = Array.from(this.chatMessages.entries())
      .filter(([_, message]) => message.sessionId === sessionId)
      .map(([id]) => id);
    
    messagesToDelete.forEach(id => this.chatMessages.delete(id));
  }
}

import { DatabaseStorage } from './db-storage';

export const storage = new DatabaseStorage();
