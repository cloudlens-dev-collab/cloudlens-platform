import { createLogger } from './logger';

const logger = createLogger('Cache');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
  };
  
  constructor(
    private readonly name: string,
    private readonly maxSize: number = 1000,
    private readonly defaultTTL: number = 300000 // 5 minutes
  ) {
    logger.info('Cache initialized', {
      name: this.name,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
    });
    
    // Start cleanup interval
    setInterval(() => this.cleanup(), 60000); // Run cleanup every minute
  }
  
  // Get item from cache
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      logger.debug('Cache miss', { cache: this.name, key });
      return null;
    }
    
    // Check if entry is expired
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug('Cache expired', { cache: this.name, key });
      return null;
    }
    
    // Update hit count
    entry.hits++;
    this.stats.hits++;
    
    logger.debug('Cache hit', { 
      cache: this.name, 
      key,
      hits: entry.hits,
    });
    
    return entry.data as T;
  }
  
  // Set item in cache
  set<T>(key: string, data: T, ttl: number = this.defaultTTL): void {
    // Check if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 0,
    };
    
    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
    
    logger.debug('Cache set', { 
      cache: this.name, 
      key,
      ttl,
    });
  }
  
  // Delete item from cache
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
      logger.debug('Cache delete', { cache: this.name, key });
    }
    return deleted;
  }
  
  // Clear entire cache
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.size = 0;
    logger.info('Cache cleared', { 
      cache: this.name, 
      itemsCleared: size,
    });
  }
  
  // Get or set with factory function
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = this.defaultTTL
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    // Generate new value
    const startTime = Date.now();
    try {
      const data = await factory();
      const duration = Date.now() - startTime;
      
      this.set(key, data, ttl);
      
      logger.debug('Cache populated', {
        cache: this.name,
        key,
        duration,
      });
      
      return data;
    } catch (error) {
      logger.error('Cache factory error', error, {
        cache: this.name,
        key,
      });
      throw error;
    }
  }
  
  // Invalidate cache entries by pattern
  invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      this.stats.size = this.cache.size;
      logger.info('Cache pattern invalidated', {
        cache: this.name,
        pattern: pattern.toString(),
        count,
      });
    }
    
    return count;
  }
  
  // Get cache statistics
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;
    
    return {
      ...this.stats,
      hitRate,
    };
  }
  
  // Private: Evict least recently used item
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    let lruHits = Infinity;
    
    // Find LRU item
    for (const [key, entry] of this.cache.entries()) {
      const lastAccess = entry.timestamp;
      if (lastAccess < lruTime || (lastAccess === lruTime && entry.hits < lruHits)) {
        lruKey = key;
        lruTime = lastAccess;
        lruHits = entry.hits;
      }
    }
    
    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      logger.debug('Cache evicted LRU', { 
        cache: this.name, 
        key: lruKey,
      });
    }
  }
  
  // Private: Clean up expired entries
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.stats.size = this.cache.size;
      logger.debug('Cache cleanup', {
        cache: this.name,
        cleaned,
        remaining: this.cache.size,
      });
    }
  }
}

// Create specific cache instances
export const caches = {
  // Cost data cache - 15 minutes TTL
  costs: new CacheService('costs', 500, 15 * 60 * 1000),
  
  // Resource data cache - 5 minutes TTL
  resources: new CacheService('resources', 1000, 5 * 60 * 1000),
  
  // Dashboard data cache - 2 minutes TTL
  dashboard: new CacheService('dashboard', 100, 2 * 60 * 1000),
  
  // AWS API responses - 1 minute TTL
  awsApi: new CacheService('awsApi', 2000, 60 * 1000),
  
  // Cost breakdown cache - 30 minutes TTL
  costBreakdown: new CacheService('costBreakdown', 500, 30 * 60 * 1000),
};

// Cache key generators
export const cacheKeys = {
  // Generate cache key for cost data
  costs(accountId?: number, startDate?: Date, endDate?: Date): string {
    const parts = ['costs'];
    if (accountId) parts.push(`account:${accountId}`);
    if (startDate) parts.push(`start:${startDate.toISOString()}`);
    if (endDate) parts.push(`end:${endDate.toISOString()}`);
    return parts.join(':');
  },
  
  // Generate cache key for resources
  resources(accountIds?: number[], filters?: any): string {
    const parts = ['resources'];
    if (accountIds) parts.push(`accounts:${accountIds.sort().join(',')}`);
    if (filters) parts.push(`filters:${JSON.stringify(filters)}`);
    return parts.join(':');
  },
  
  // Generate cache key for dashboard
  dashboard(accountIds?: number[]): string {
    const parts = ['dashboard'];
    if (accountIds) parts.push(`accounts:${accountIds.sort().join(',')}`);
    return parts.join(':');
  },
  
  // Generate cache key for AWS API calls
  awsApi(account: string, service: string, operation: string, params?: any): string {
    const parts = ['aws', account, service, operation];
    if (params) parts.push(JSON.stringify(params));
    return parts.join(':');
  },
  
  // Generate cache key for cost breakdown
  costBreakdown(resourceId: string): string {
    return `costBreakdown:${resourceId}`;
  },
};

// Cache invalidation helpers
export const invalidateCache = {
  // Invalidate all caches for an account
  account(accountId: number): void {
    const pattern = new RegExp(`(account:${accountId}|accounts:[^:]*${accountId})`);
    
    Object.values(caches).forEach(cache => {
      cache.invalidatePattern(pattern);
    });
    
    logger.info('Account cache invalidated', { accountId });
  },
  
  // Invalidate cost-related caches
  costs(): void {
    caches.costs.clear();
    caches.costBreakdown.clear();
    caches.dashboard.clear();
    
    logger.info('Cost caches invalidated');
  },
  
  // Invalidate resource-related caches
  resources(): void {
    caches.resources.clear();
    caches.dashboard.clear();
    
    logger.info('Resource caches invalidated');
  },
};

// Export cache statistics for monitoring
export function getCacheStatistics(): Record<string, any> {
  const stats: Record<string, any> = {};
  
  Object.entries(caches).forEach(([name, cache]) => {
    stats[name] = cache.getStats();
  });
  
  return stats;
}