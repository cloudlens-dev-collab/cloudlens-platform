import { users, accounts, resources, costs, alerts, chatMessages, type User, type InsertUser, type Account, type InsertAccount, type Resource, type InsertResource, type Cost, type InsertCost, type Alert, type InsertAlert, type ChatMessage, type InsertChatMessage } from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, or, inArray } from "drizzle-orm";
import type { IStorage } from "./storage";

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Accounts
  async getAccounts(): Promise<Account[]> {
    return await db.select().from(accounts).orderBy(desc(accounts.createdAt));
  }

  async getAccount(id: number): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account || undefined;
  }

  async getAccountsByProvider(provider: string): Promise<Account[]> {
    return await db.select().from(accounts).where(eq(accounts.provider, provider));
  }

  async createAccount(insertAccount: InsertAccount): Promise<Account> {
    const [account] = await db
      .insert(accounts)
      .values({
        ...insertAccount,
        status: insertAccount.status || "active",
        createdAt: new Date(),
        lastSyncAt: null
      })
      .returning();
    return account;
  }

  async updateAccount(id: number, updates: Partial<InsertAccount>): Promise<Account> {
    const [account] = await db
      .update(accounts)
      .set({ ...updates, lastSyncAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    if (!account) throw new Error('Account not found');
    return account;
  }

  async deleteAccount(id: number): Promise<void> {
    await db.delete(accounts).where(eq(accounts.id, id));
  }

  // Resources
  async getResources(accountIds?: number[]): Promise<Resource[]> {
    if (accountIds && accountIds.length > 0) {
      // Use OR conditions instead of inArray for better compatibility
      const conditions = accountIds.map(id => eq(resources.accountId, id));
      if (conditions.length === 1) {
        return await db.select().from(resources).where(conditions[0]);
      } else {
        return await db.select().from(resources).where(or(...conditions));
      }
    }
    return await db.select().from(resources).orderBy(desc(resources.lastUpdated));
  }

  async getResourcesByAccount(accountId: number): Promise<Resource[]> {
    return await db.select().from(resources).where(eq(resources.accountId, accountId));
  }

  async getResourcesByType(type: string, accountIds?: number[]): Promise<Resource[]> {
    let query = db.select().from(resources).where(eq(resources.type, type));
    if (accountIds && accountIds.length > 0) {
      query = query.where(eq(resources.accountId, accountIds[0]));
    }
    return await query;
  }

  async createResource(insertResource: InsertResource): Promise<Resource> {
    const [resource] = await db
      .insert(resources)
      .values({
        ...insertResource,
        lastUpdated: new Date(),
        monthlyCost: insertResource.monthlyCost || null
      })
      .returning();
    return resource;
  }

  async updateResource(id: number, updates: Partial<InsertResource>): Promise<Resource> {
    const [resource] = await db
      .update(resources)
      .set({ ...updates, lastUpdated: new Date() })
      .where(eq(resources.id, id))
      .returning();
    if (!resource) throw new Error('Resource not found');
    return resource;
  }

  async deleteResource(id: number): Promise<void> {
    await db.delete(resources).where(eq(resources.id, id));
  }

  async deleteResourcesByAccount(accountId: number): Promise<void> {
    await db.delete(resources).where(eq(resources.accountId, accountId));
  }

  // Costs
  async getCosts(accountIds?: number[], startDate?: Date, endDate?: Date): Promise<Cost[]> {
    let query = db.select().from(costs);
    
    const conditions = [];
    if (accountIds && accountIds.length > 0) {
      conditions.push(inArray(costs.accountId, accountIds));
    }
    if (startDate) {
      conditions.push(gte(costs.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(costs.date, endDate));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    return await query.orderBy(desc(costs.date));
  }

  async getCostsByAccount(accountId: number, startDate?: Date, endDate?: Date): Promise<Cost[]> {
    let query = db.select().from(costs).where(eq(costs.accountId, accountId));
    
    if (startDate && endDate) {
      query = query.where(and(
        eq(costs.accountId, accountId),
        gte(costs.date, startDate),
        lte(costs.date, endDate)
      ));
    }
    
    return await query.orderBy(desc(costs.date));
  }

  async getCostTrends(accountIds?: number[], period = 'monthly'): Promise<Cost[]> {
    return await this.getCosts(accountIds);
  }

  async createCost(insertCost: InsertCost): Promise<Cost> {
    try {
      console.log(`Creating cost record: ${insertCost.service} = $${insertCost.amount} for account ${insertCost.accountId}`);
      const [cost] = await db
        .insert(costs)
        .values({
          ...insertCost,
          period: insertCost.period || 'daily'
        })
        .returning();
      console.log(`Cost record created with ID: ${cost.id}`);
      return cost;
    } catch (error) {
      console.error('Error creating cost record:', error);
      console.error('Insert data:', insertCost);
      throw error;
    }
  }

  // Alerts
  async getAlerts(accountIds?: number[]): Promise<Alert[]> {
    if (accountIds && accountIds.length > 0) {
      return await db.select().from(alerts).where(eq(alerts.accountId, accountIds[0]));
    }
    return await db.select().from(alerts).orderBy(desc(alerts.createdAt));
  }

  async getUnreadAlerts(accountIds?: number[]): Promise<Alert[]> {
    let query = db.select().from(alerts).where(eq(alerts.isRead, false));
    if (accountIds && accountIds.length > 0) {
      query = query.where(and(eq(alerts.isRead, false), eq(alerts.accountId, accountIds[0])));
    }
    return await query.orderBy(desc(alerts.createdAt));
  }

  async createAlert(insertAlert: InsertAlert): Promise<Alert> {
    const [alert] = await db
      .insert(alerts)
      .values({
        ...insertAlert,
        isRead: false,
        createdAt: new Date()
      })
      .returning();
    return alert;
  }

  async markAlertAsRead(id: number): Promise<void> {
    await db.update(alerts).set({ isRead: true }).where(eq(alerts.id, id));
  }

  // Chat Messages
  async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return await db.select().from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
  }

  async createChatMessage(insertMessage: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db
      .insert(chatMessages)
      .values({
        ...insertMessage,
        createdAt: new Date()
      })
      .returning();
    return message;
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
  }
}