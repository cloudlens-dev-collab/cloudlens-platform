import { createLogger } from './logger';
import { RateLimitError } from './error-handler';

const logger = createLogger('RateLimiter');

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: any) => string;
  onLimitReached?: (req: any) => void;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: Required<RateLimitConfig>;
  
  constructor(config: RateLimitConfig) {
    this.config = {
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown',
      onLimitReached: () => {},
      ...config,
    };
    
    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }
  
  middleware() {
    return (req: any, res: any, next: any) => {
      const key = this.config.keyGenerator(req);
      const now = Date.now();
      
      // Get or create entry
      let entry = this.store.get(key);
      if (!entry || now > entry.resetTime) {
        entry = {
          count: 0,
          resetTime: now + this.config.windowMs,
        };
      }
      
      // Check if limit exceeded
      if (entry.count >= this.config.maxRequests) {
        const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
        
        this.config.onLimitReached(req);
        logger.warn('Rate limit exceeded', {
          key,
          count: entry.count,
          limit: this.config.maxRequests,
          retryAfter,
          path: req.path,
          method: req.method,
        });
        
        res.set({
          'X-RateLimit-Limit': this.config.maxRequests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(entry.resetTime).toISOString(),
          'Retry-After': retryAfter,
        });
        
        throw new RateLimitError(retryAfter);
      }
      
      // Increment counter
      entry.count++;
      this.store.set(key, entry);
      
      // Set headers
      res.set({
        'X-RateLimit-Limit': this.config.maxRequests,
        'X-RateLimit-Remaining': Math.max(0, this.config.maxRequests - entry.count),
        'X-RateLimit-Reset': new Date(entry.resetTime).toISOString(),
      });
      
      // Track response to potentially skip counting
      const originalSend = res.send;
      res.send = function(data: any) {
        res.send = originalSend;
        
        const shouldSkip = 
          (res.statusCode < 400 && config.skipSuccessfulRequests) ||
          (res.statusCode >= 400 && config.skipFailedRequests);
        
        if (shouldSkip) {
          entry!.count--;
          store.set(key, entry!);
        }
        
        return res.send(data);
      };
      
      next();
    };
  }
  
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug('Rate limiter cleanup', {
        cleaned,
        remaining: this.store.size,
      });
    }
  }
}

// Create rate limiters for different endpoints
export const rateLimiters = {
  // General API rate limit: 100 requests per minute
  api: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyGenerator: (req) => req.ip,
  }),
  
  // Sync operations: 5 per hour per account
  sync: new RateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 5,
    keyGenerator: (req) => `${req.ip}:sync:${req.params.id || 'unknown'}`,
    onLimitReached: (req) => {
      logger.warn('Sync rate limit exceeded', {
        ip: req.ip,
        accountId: req.params.id,
      });
    },
  }),
  
  // Chat: 30 messages per minute
  chat: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyGenerator: (req) => `${req.ip}:chat`,
  }),
  
  // Authentication: 10 attempts per 15 minutes
  auth: new RateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    skipSuccessfulRequests: true, // Don't count successful logins
    keyGenerator: (req) => req.ip,
  }),
};