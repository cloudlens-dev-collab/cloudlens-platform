import { Request, Response, Express } from "express";
import { createServer, Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { llmService } from "./services/llm";
import { simpleOrchestrator } from "./agents/simple-orchestrator";
import { sqlAgent } from "./agents/sql-agent";
import { createLogger, requestLogger } from "./services/logger";
import { asyncHandler, globalErrorHandler, AppError, NotFoundError, ValidationError } from "./services/error-handler";
import { validateRequest, requestSchemas, sanitize, validateDataQuality } from "./services/validation";
import { caches, cacheKeys, invalidateCache } from "./services/cache";

const logger = createLogger('Routes');

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Apply middleware
  app.use(requestLogger());
  
  // ===================
  // HEALTH & MONITORING
  // ===================
  
  app.get("/health", (req, res) => {
    res.json({ 
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  
  app.get("/api/monitoring/metrics", asyncHandler(async (req, res) => {
    const { getCacheStatistics } = await import('./services/cache');
    
    res.json({
      cache: getCacheStatistics(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    });
  }));
  
  // ===================
  // ACCOUNTS ENDPOINTS
  // ===================
  
  app.get("/api/accounts", asyncHandler(async (req: Request, res: Response) => {
    logger.info('Fetching accounts');
    
    // Check cache first
    const cached = caches.resources.get('accounts:all');
    if (cached) {
      return res.json(cached);
    }
    
    const accounts = await storage.getAccounts();
    
    // Sanitize credentials before caching
    const sanitizedAccounts = accounts.map(account => ({
      ...account,
      credentials: sanitize.credentials(account.credentials)
    }));
    
    // Cache for 5 minutes
    caches.resources.set('accounts:all', sanitizedAccounts, 5 * 60 * 1000);
    
    res.json(sanitizedAccounts);
  }));
  
  app.post("/api/accounts", 
    validateRequest(requestSchemas.createAccount),
    asyncHandler(async (req: Request, res: Response) => {
      const accountData = req.validated as any;
      
      logger.info('Creating account', {
        name: accountData.name,
        provider: accountData.provider
      });
      
      // Check if account already exists
      const existing = await storage.getAccounts();
      const duplicate = existing.find(acc => 
        acc.accountId === accountData.accountId && 
        acc.provider === accountData.provider
      );
      
      if (duplicate) {
        throw new ValidationError('Account already exists with this ID and provider');
      }
      
      const account = await storage.createAccount(accountData);
      
      // Invalidate caches
      invalidateCache.account(account.id);
      
      logger.info('Account created successfully', {
        accountId: account.id,
        name: account.name
      });
      
      res.status(201).json({
        ...account,
        credentials: sanitize.credentials(account.credentials)
      });
    })
  );
  
  app.put("/api/accounts/:id", 
    validateRequest(requestSchemas.updateAccount),
    asyncHandler(async (req: Request, res: Response) => {
      const id = parseInt(req.params.id);
      const updates = req.validated as any;
      
      logger.info('Updating account', { accountId: id });
      
      const account = await storage.getAccount(id);
      if (!account) {
        throw new NotFoundError('Account');
      }
      
      const updated = await storage.updateAccount(id, updates);
      
      // Invalidate caches
      invalidateCache.account(id);
      
      res.json({
        ...updated,
        credentials: sanitize.credentials(updated.credentials)
      });
    })
  );
  
  app.delete("/api/accounts/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    
    logger.info('Deleting account', { accountId: id });
    
    const account = await storage.getAccount(id);
    if (!account) {
      throw new NotFoundError('Account');
    }
    
    await storage.deleteAccount(id);
    
    // Invalidate all caches for this account
    invalidateCache.account(id);
    
    logger.info('Account deleted successfully', { accountId: id });
    
    res.status(204).send();
  }));
  
  app.post("/api/accounts/:id/sync", asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    
    logger.info('Starting account sync', { accountId: id });
    
    const account = await storage.getAccount(id);
    if (!account) {
      throw new NotFoundError('Account');
    }
    
    // Invalidate caches before sync
    invalidateCache.account(id);
    
    // Import and run sync based on provider
    let syncedResources: any[] = [];
    const startTime = Date.now();
    
    try {
      switch (account.provider) {
        case 'aws':
          const { awsService } = await import('./services/aws');
          syncedResources = await awsService.syncResources(account);
          break;
        case 'azure':
          const { azureService } = await import('./services/azure');
          syncedResources = await azureService.syncResources(account);
          break;
        case 'snowflake':
          const { snowflakeService } = await import('./services/snowflake');
          syncedResources = await snowflakeService.syncResources(account);
          break;
        default:
          throw new ValidationError(`Unsupported provider: ${account.provider}`);
      }
      
      // Update resources in storage
      await storage.deleteResourcesByAccount(id);
      
      for (const resource of syncedResources) {
        // Validate and sanitize resource data
        resource.name = sanitize.resourceName(resource.name);
        resource.metadata = sanitize.metadata(resource.metadata);
        resource.monthlyCost = sanitize.cost(resource.monthlyCost);
        
        // Check data quality
        validateDataQuality('resource', resource);
        
        await storage.createResource(resource);
      }
      
      // Update account sync timestamp
      await storage.updateAccount(id, { lastSyncAt: new Date() });
      
      const duration = Date.now() - startTime;
      logger.sync(account.name, 'completed', {
        resourceCount: syncedResources.length,
        duration
      });
      
      res.json({
        success: true,
        resourceCount: syncedResources.length,
        duration,
        message: `Synced ${syncedResources.length} resources in ${duration}ms`
      });
      
    } catch (error) {
      logger.sync(account.name, 'failed', { error });
      throw error;
    }
  }));
  
  // ===================
  // DASHBOARD ENDPOINTS  
  // ===================
  
  app.get("/api/dashboard/summary", asyncHandler(async (req: Request, res: Response) => {
    const { accountIds } = req.query;
    
    let targetAccountIds: number[] | undefined;
    if (accountIds && accountIds !== 'all') {
      targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    }
    
    // Generate cache key
    const cacheKey = cacheKeys.dashboard(targetAccountIds);
    
    // Check cache
    const cached = caches.dashboard.get(cacheKey);
    if (cached) {
      logger.debug('Dashboard cache hit', { accountIds });
      return res.json(cached);
    }
    
    logger.info('Generating dashboard summary', { accountIds });
    
    // Fetch data with performance tracking
    const startTime = Date.now();
    
    const [accounts, resources, costs, alerts] = await Promise.all([
      storage.getAccounts(),
      storage.getResources(targetAccountIds),
      storage.getCosts(targetAccountIds),
      storage.getAlerts(targetAccountIds)
    ]);
    
    // Calculate metrics
    const activeResources = resources.filter(r => r.status === 'active' || r.status === 'running');
    const totalCost = resources.reduce((sum, r) => sum + (parseFloat(r.monthlyCost || '0')), 0);
    const criticalAlerts = alerts.filter(a => a.severity === 'critical' && !a.isRead);
    
    // Resource breakdown by type
    const resourceBreakdown: Record<string, number> = {};
    resources.forEach(r => {
      resourceBreakdown[r.type] = (resourceBreakdown[r.type] || 0) + 1;
    });
    
    // Cost trend (mock data for now - should calculate from historical data)
    const currentCost = totalCost.toFixed(2);
    const previousCost = (totalCost * 0.95).toFixed(2);
    const percentChange = "5.0";
    
    // Calculate potential savings (simplified)
    const potentialSavings = resources
      .filter(r => r.status === 'stopped' || r.status === 'inactive')
      .reduce((sum, r) => sum + (parseFloat(r.monthlyCost || '0')), 0);
    
    const summary = {
      totalAccounts: targetAccountIds ? targetAccountIds.length : accounts.length,
      totalResources: resources.length,
      activeResources: activeResources.length,
      totalCost: currentCost,
      alertCount: alerts.length,
      criticalAlertCount: criticalAlerts.length,
      potentialSavings: potentialSavings.toFixed(2),
      resourceBreakdown,
      costTrend: {
        current: currentCost,
        previous: previousCost,
        percentChange
      }
    };
    
    // Cache the result
    caches.dashboard.set(cacheKey, summary);
    
    const duration = Date.now() - startTime;
    logger.performance('dashboard_summary', duration, {
      accountCount: summary.totalAccounts,
      resourceCount: summary.totalResources
    });
    
    res.json(summary);
  }));
  
  // ===================
  // CHAT ENDPOINTS
  // ===================
  
  app.post("/api/chat", 
    validateRequest(requestSchemas.chatMessage),
    asyncHandler(async (req: Request, res: Response) => {
      const { message, sessionId, accountContext, model = 'openai' } = req.validated as any;
      
      logger.info('Processing chat message', {
        sessionId,
        model,
        messageLength: message.length,
        hasAccountContext: !!accountContext
      });
      
      const startTime = Date.now();
      
      // Store user message
      const userMessage = await storage.createChatMessage({
        sessionId,
        role: 'user',
        content: message,
        model,
        accountContext: accountContext ? JSON.stringify(accountContext) : null,
      });
      
      // Get conversation history
      const history = await storage.getChatMessages(sessionId);
      
      // Get account data if context provided
      let accounts: any[] = [];
      let resources: any[] = [];
      
      if (accountContext && accountContext.length > 0) {
        accounts = await Promise.all(
          accountContext.map((id: number) => storage.getAccount(id))
        );
        resources = await storage.getResources(accountContext);
      }
      
      // Choose agent based on message content
      let response: any;
      
      if (message.toLowerCase().includes('sql') || 
          message.toLowerCase().includes('query') ||
          message.toLowerCase().includes('database')) {
        response = await sqlAgent.process(message, {
          accounts,
          resources,
          history: history.slice(-10),
          sessionId
        });
      } else {
        response = await simpleOrchestrator.process(message, {
          accounts,
          resources,
          history: history.slice(-10),
          sessionId
        });
      }
      
      // Store assistant response
      const assistantMessage = await storage.createChatMessage({
        sessionId,
        role: 'assistant',
        content: response.response,
        model,
        accountContext: accountContext ? JSON.stringify(accountContext) : null,
      });
      
      const duration = Date.now() - startTime;
      logger.info('Chat message processed', {
        sessionId,
        duration,
        hasFollowUps: response.followUps?.length > 0
      });
      
      res.json({
        llmMetrics: {
          model,
          usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          timestamp: new Date()
        },
        assistantMessage: {
          ...assistantMessage,
          followUps: response.followUps,
          searchResults: response.searchResults
        }
      });
    })
  );
  
  app.get("/api/chat/:sessionId", asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    
    logger.debug('Fetching chat history', { sessionId });
    
    const messages = await storage.getChatMessages(sessionId);
    res.json(messages);
  }));
  
  app.delete("/api/chat/:sessionId", asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    
    logger.info('Deleting chat session', { sessionId });
    
    await storage.deleteChatSession(sessionId);
    res.status(204).send();
  }));
  
  // ===================
  // RESOURCES ENDPOINTS
  // ===================
  
  app.get("/api/resources", 
    asyncHandler(async (req: Request, res: Response) => {
      const query = req.query;
      
      // Validate query parameters
      const validated = await requestSchemas.resourceQuery.parseAsync(query);
      
      let targetAccountIds: number[] | undefined;
      if (validated.accountIds && validated.accountIds !== 'all') {
        targetAccountIds = validated.accountIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }
      
      // Generate cache key
      const cacheKey = cacheKeys.resources(targetAccountIds, validated);
      
      // Check cache
      const cached = caches.resources.get(cacheKey);
      if (cached) {
        logger.debug('Resources cache hit', { 
          accountIds: targetAccountIds,
          filters: validated 
        });
        return res.json(cached);
      }
      
      logger.info('Fetching resources', {
        accountIds: targetAccountIds,
        filters: validated
      });
      
      // Fetch and filter resources
      let resources = await storage.getResources(targetAccountIds);
      
      // Apply filters
      if (validated.search) {
        const searchTerm = validated.search.toLowerCase();
        resources = resources.filter(resource => 
          resource.name?.toLowerCase().includes(searchTerm) ||
          resource.resourceId?.toLowerCase().includes(searchTerm) ||
          resource.type?.toLowerCase().includes(searchTerm)
        );
      }
      
      if (validated.provider && validated.provider !== 'all') {
        resources = resources.filter(resource => resource.provider === validated.provider);
      }
      
      if (validated.type && validated.type !== 'all') {
        resources = resources.filter(resource => resource.type === validated.type);
      }
      
      if (validated.status && validated.status !== 'all') {
        resources = resources.filter(resource => resource.status === validated.status);
      }
      
      // Apply sorting
      const sortBy = validated.sortBy || 'name';
      const sortOrder = validated.sortOrder || 'asc';
      
      resources.sort((a, b) => {
        let aValue: any = a[sortBy as keyof typeof a];
        let bValue: any = b[sortBy as keyof typeof b];
        
        // Handle null/undefined values
        if (aValue == null) aValue = sortBy === 'monthlyCost' ? 0 : '';
        if (bValue == null) bValue = sortBy === 'monthlyCost' ? 0 : '';
        
        // Special handling for numeric fields
        if (sortBy === 'monthlyCost' || sortBy === 'cost') {
          const aNum = parseFloat(String(aValue)) || 0;
          const bNum = parseFloat(String(bValue)) || 0;
          const comparison = aNum - bNum;
          return sortOrder === 'desc' ? -comparison : comparison;
        }
        
        // String comparison
        const comparison = String(aValue).localeCompare(String(bValue));
        return sortOrder === 'desc' ? -comparison : comparison;
      });
      
      // Cache the filtered results
      caches.resources.set(cacheKey, resources);
      
      logger.info('Resources fetched', {
        total: resources.length,
        filtered: resources.length
      });
      
      res.json(resources);
    })
  );
  
  // Get detailed cost breakdown for a specific resource
  app.get("/api/resources/:resourceId/cost-breakdown", 
    asyncHandler(async (req: Request, res: Response) => {
      const { resourceId } = req.params;
      
      // Check cache
      const cacheKey = cacheKeys.costBreakdown(resourceId);
      const cached = caches.costBreakdown.get(cacheKey);
      if (cached) {
        logger.debug('Cost breakdown cache hit', { resourceId });
        return res.json(cached);
      }
      
      logger.info('Fetching cost breakdown', { resourceId });
      
      const resource = await storage.getResourceByResourceId(resourceId);
      if (!resource) {
        throw new NotFoundError('Resource');
      }
      
      const costBreakdown = resource.costBreakdown;
      
      const response = {
        resourceId,
        totalCost: costBreakdown?.totalCost || parseFloat(resource.monthlyCost || '0'),
        services: costBreakdown?.services || {},
        usageTypes: costBreakdown?.usageTypes || {},
        dailyCosts: costBreakdown?.dailyCosts || [],
        period: "month-to-date",
        message: !costBreakdown ? "No detailed cost breakdown available" : undefined
      };
      
      // Cache the response
      caches.costBreakdown.set(cacheKey, response);
      
      res.json(response);
    })
  );
  
  // ===================
  // COSTS ENDPOINTS
  // ===================
  
  app.get("/api/costs", asyncHandler(async (req: Request, res: Response) => {
    const { accountIds, startDate, endDate } = req.query;
    
    let targetAccountIds: number[] | undefined;
    if (accountIds && accountIds !== 'all') {
      targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    }
    
    const start = startDate ? new Date(String(startDate)) : undefined;
    const end = endDate ? new Date(String(endDate)) : undefined;
    
    // Generate cache key
    const cacheKey = cacheKeys.costs(
      targetAccountIds?.[0], 
      start, 
      end
    );
    
    // Check cache
    const cached = caches.costs.get(cacheKey);
    if (cached) {
      logger.debug('Costs cache hit');
      return res.json(cached);
    }
    
    logger.info('Fetching costs', {
      accountIds: targetAccountIds,
      startDate: start,
      endDate: end
    });
    
    const costs = await storage.getCosts(targetAccountIds, start, end);
    
    // Validate cost data consistency
    validateDataQuality('costs', costs);
    
    // Cache the results
    caches.costs.set(cacheKey, costs);
    
    res.json(costs);
  }));
  
  app.get("/api/costs/trends", asyncHandler(async (req: Request, res: Response) => {
    const { accountIds, days = '30' } = req.query;
    
    let targetAccountIds: number[] | undefined;
    if (accountIds && accountIds !== 'all') {
      targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    }
    
    const daysNum = parseInt(String(days));
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    
    logger.info('Fetching cost trends', {
      accountIds: targetAccountIds,
      days: daysNum
    });
    
    const costs = await storage.getCosts(targetAccountIds, startDate, endDate);
    res.json(costs);
  }));
  
  // ===================
  // ALERTS ENDPOINTS
  // ===================
  
  app.get("/api/alerts", asyncHandler(async (req: Request, res: Response) => {
    const { accountIds, unreadOnly } = req.query;
    
    let targetAccountIds: number[] | undefined;
    if (accountIds && accountIds !== 'all') {
      targetAccountIds = String(accountIds).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    }
    
    logger.debug('Fetching alerts', {
      accountIds: targetAccountIds,
      unreadOnly
    });
    
    let alerts = await storage.getAlerts(targetAccountIds);
    
    if (unreadOnly === 'true') {
      alerts = alerts.filter(a => !a.isRead);
    }
    
    res.json(alerts);
  }));
  
  app.put("/api/alerts/:id/read", asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    
    logger.info('Marking alert as read', { alertId: id });
    
    const alert = await storage.updateAlert(id, { isRead: true });
    res.json(alert);
  }));
  
  // Apply global error handler
  app.use(globalErrorHandler);
  
  const server = createServer(app);
  return server;
}