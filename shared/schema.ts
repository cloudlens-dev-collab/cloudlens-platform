import { pgTable, text, serial, integer, boolean, timestamp, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(), // 'aws', 'azure', 'snowflake'
  accountId: text("account_id").notNull(),
  status: text("status").notNull().default("active"), // 'active', 'inactive', 'error'
  credentials: jsonb("credentials").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at"),
});

export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  resourceId: text("resource_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'ec2', 'rds', 'vm', 'warehouse', etc.
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  region: text("region"),
  metadata: jsonb("metadata"),
  monthlyCost: decimal("monthly_cost", { precision: 10, scale: 2 }),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

export const costs = pgTable("costs", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  service: text("service").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  period: text("period").notNull(), // 'daily', 'monthly'
  date: timestamp("date").notNull(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accounts.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull(), // 'critical', 'warning', 'info'
  type: text("type").notNull(), // 'cost', 'performance', 'security'
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'user', 'assistant'
  content: text("content").notNull(),
  model: text("model"), // 'openai', 'claude', 'gemini', 'perplexity'
  accountContext: text("account_context"), // JSON string of account IDs in context
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
  lastSyncAt: true,
});

export const insertResourceSchema = createInsertSchema(resources).omit({
  id: true,
  lastUpdated: true,
});

export const insertCostSchema = createInsertSchema(costs).omit({
  id: true,
});

export const insertAlertSchema = createInsertSchema(alerts).omit({
  id: true,
  createdAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;

export type Resource = typeof resources.$inferSelect;
export type InsertResource = z.infer<typeof insertResourceSchema>;

export type Cost = typeof costs.$inferSelect;
export type InsertCost = z.infer<typeof insertCostSchema>;

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
