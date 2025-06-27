import { z } from 'zod';
import { createLogger } from './logger';

const logger = createLogger('Validation');

// Common validation schemas
export const schemas = {
  // ID validations
  numericId: z.number().int().positive(),
  stringId: z.string().min(1).max(255),
  
  // AWS specific
  awsResourceId: z.string().regex(/^[a-zA-Z0-9-_:/.]+$/),
  awsRegion: z.string().regex(/^[a-z]{2}-[a-z]+-\d{1}$/),
  awsAccountId: z.string().regex(/^\d{12}$/),
  
  // Azure specific
  azureResourceId: z.string().startsWith('/subscriptions/'),
  azureRegion: z.string().min(1),
  
  // Common fields
  email: z.string().email(),
  url: z.string().url(),
  date: z.string().datetime(),
  currency: z.string().length(3),
  money: z.number().nonnegative().multipleOf(0.01),
  percentage: z.number().min(0).max(100),
  
  // Pagination
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  
  // Sorting
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  
  // Status values
  resourceStatus: z.enum(['active', 'inactive', 'terminated', 'stopped', 'running', 'pending', 'unknown']),
  accountStatus: z.enum(['active', 'inactive', 'error']),
  alertSeverity: z.enum(['critical', 'warning', 'info']),
  
  // Provider values
  provider: z.enum(['aws', 'azure', 'gcp', 'snowflake']),
};

// Request validation schemas
export const requestSchemas = {
  // Query parameters
  resourceQuery: z.object({
    accountIds: z.string().optional(),
    search: z.string().optional(),
    provider: schemas.provider.optional(),
    type: z.string().optional(),
    status: schemas.resourceStatus.optional(),
    sortBy: z.string().optional(),
    sortOrder: schemas.sortOrder.optional(),
    page: schemas.page.optional(),
    limit: schemas.limit.optional(),
  }),

  costQuery: z.object({
    accountIds: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    groupBy: z.enum(['service', 'account', 'region', 'day', 'month']).optional(),
  }),

  // Body schemas
  createAccount: z.object({
    name: z.string().min(1).max(100),
    provider: schemas.provider,
    accountId: z.string().min(1),
    credentials: z.record(z.any()),
  }),

  updateAccount: z.object({
    name: z.string().min(1).max(100).optional(),
    status: schemas.accountStatus.optional(),
    credentials: z.record(z.any()).optional(),
  }),

  chatMessage: z.object({
    message: z.string().min(1).max(10000),
    sessionId: z.string().min(1),
    accountContext: z.array(z.number()).optional(),
    model: z.enum(['openai', 'claude', 'gemini', 'perplexity']).optional(),
  }),
};

// Response validation schemas
export const responseSchemas = {
  resource: z.object({
    id: schemas.numericId,
    accountId: schemas.numericId,
    resourceId: z.string(),
    name: z.string(),
    type: z.string(),
    provider: schemas.provider,
    status: z.string(),
    region: z.string().nullable(),
    metadata: z.record(z.any()).nullable(),
    monthlyCost: z.string().nullable(),
    costBreakdown: z.any().nullable(),
    lastUpdated: z.string().datetime(),
  }),

  account: z.object({
    id: schemas.numericId,
    name: z.string(),
    provider: schemas.provider,
    accountId: z.string(),
    status: schemas.accountStatus,
    createdAt: z.string().datetime(),
    lastSyncAt: z.string().datetime().nullable(),
  }),

  cost: z.object({
    id: schemas.numericId,
    accountId: schemas.numericId,
    service: z.string(),
    amount: z.string(),
    currency: z.string(),
    period: z.enum(['daily', 'monthly']),
    date: z.string().datetime(),
  }),

  costBreakdown: z.object({
    resourceId: z.string(),
    totalCost: z.number(),
    services: z.record(z.number()),
    usageTypes: z.record(z.number()),
    dailyCosts: z.array(z.object({
      date: z.string(),
      service: z.string(),
      cost: z.number(),
    })),
    period: z.string(),
    message: z.string().optional(),
  }),
};

// Data quality validators
export const dataQuality = {
  // Check if resource data is complete
  validateResourceCompleteness(resource: any): string[] {
    const issues: string[] = [];
    
    if (!resource.name || resource.name === 'Unknown') {
      issues.push('Missing or invalid resource name');
    }
    
    if (!resource.resourceId) {
      issues.push('Missing resource ID');
    }
    
    if (!resource.region && resource.type !== 's3-bucket') {
      issues.push('Missing region for regional resource');
    }
    
    if (resource.monthlyCost && parseFloat(resource.monthlyCost) < 0) {
      issues.push('Invalid negative cost');
    }
    
    return issues;
  },

  // Check cost data consistency
  validateCostConsistency(costs: any[]): string[] {
    const issues: string[] = [];
    
    // Check for duplicate entries
    const seen = new Set();
    costs.forEach(cost => {
      const key = `${cost.accountId}-${cost.service}-${cost.date}`;
      if (seen.has(key)) {
        issues.push(`Duplicate cost entry: ${key}`);
      }
      seen.add(key);
    });
    
    // Check for gaps in daily data
    if (costs.length > 1) {
      const dates = costs.map(c => new Date(c.date).getTime()).sort();
      for (let i = 1; i < dates.length; i++) {
        const diff = dates[i] - dates[i-1];
        const daysDiff = diff / (1000 * 60 * 60 * 24);
        if (daysDiff > 1.5) {
          issues.push(`Gap in cost data between ${new Date(dates[i-1]).toISOString()} and ${new Date(dates[i]).toISOString()}`);
        }
      }
    }
    
    return issues;
  },

  // Validate AWS-specific data
  validateAwsResource(resource: any): string[] {
    const issues: string[] = [];
    
    if (resource.provider !== 'aws') return issues;
    
    // Validate resource ID format
    const resourceIdPatterns: Record<string, RegExp> = {
      'ec2-instance': /^i-[0-9a-f]{8,17}$/,
      's3-bucket': /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
      'rds-instance': /^[a-z][a-z0-9-]*$/,
      'lambda-function': /^[a-zA-Z0-9-_]+$/,
      'vpc': /^vpc-[0-9a-f]{8,17}$/,
      'subnet': /^subnet-[0-9a-f]{8,17}$/,
      'security-group': /^sg-[0-9a-f]{8,17}$/,
    };
    
    const pattern = resourceIdPatterns[resource.type];
    if (pattern && !pattern.test(resource.resourceId)) {
      issues.push(`Invalid AWS resource ID format for ${resource.type}: ${resource.resourceId}`);
    }
    
    // Validate region format
    if (resource.region && !schemas.awsRegion.safeParse(resource.region).success) {
      issues.push(`Invalid AWS region format: ${resource.region}`);
    }
    
    return issues;
  },
};

// Sanitization functions
export const sanitize = {
  // Remove sensitive data from logs
  credentials(creds: any): any {
    const sanitized = { ...creds };
    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'credential'];
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '***REDACTED***';
      }
    });
    
    return sanitized;
  },

  // Clean resource metadata
  metadata(metadata: any): any {
    if (!metadata) return null;
    
    const cleaned = { ...metadata };
    
    // Remove null/undefined values
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === null || cleaned[key] === undefined) {
        delete cleaned[key];
      }
    });
    
    // Sanitize sensitive fields
    if (cleaned.tags) {
      cleaned.tags = Array.isArray(cleaned.tags) 
        ? cleaned.tags.filter(tag => tag && tag.Key && tag.Value)
        : cleaned.tags;
    }
    
    return cleaned;
  },

  // Normalize cost values
  cost(value: any): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) {
      return null;
    }
    
    return num.toFixed(2);
  },

  // Clean and validate resource name
  resourceName(name: any): string {
    if (!name || typeof name !== 'string') {
      return 'Unknown';
    }
    
    // Remove special characters that could cause issues
    return name
      .replace(/[^\w\s.-]/g, '')
      .trim()
      .substring(0, 255) || 'Unknown';
  },
};

// Validation middleware for Express
export function validateRequest(schema: z.ZodSchema) {
  return async (req: any, res: any, next: any) => {
    try {
      const validated = await schema.parseAsync(req.body || req.query);
      req.validated = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Request validation failed', {
          path: req.path,
          errors: error.errors,
        });
        
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      } else {
        next(error);
      }
    }
  };
}

// Validate and log data quality issues
export function validateDataQuality(type: string, data: any) {
  const issues: string[] = [];
  
  switch (type) {
    case 'resource':
      issues.push(...dataQuality.validateResourceCompleteness(data));
      if (data.provider === 'aws') {
        issues.push(...dataQuality.validateAwsResource(data));
      }
      break;
    case 'costs':
      if (Array.isArray(data)) {
        issues.push(...dataQuality.validateCostConsistency(data));
      }
      break;
  }
  
  if (issues.length > 0) {
    logger.dataQuality(`${type} validation issues`, {
      type,
      issues,
      dataId: data.id || data.resourceId,
    });
  }
  
  return issues;
}