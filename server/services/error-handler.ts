import { createLogger } from './logger';

const logger = createLogger('ErrorHandler');

// Custom error classes
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: any;
  public readonly code?: string;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    code?: string,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, true, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, true, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, true, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, true, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, true, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 429, true, 'RATE_LIMIT', { retryAfter });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: any) {
    super(`External service error: ${service}`, 502, true, 'EXTERNAL_SERVICE_ERROR', {
      service,
      originalError: originalError?.message || originalError,
    });
  }
}

// AWS specific errors
export class AWSError extends ExternalServiceError {
  constructor(operation: string, error: any) {
    const message = error.message || 'AWS operation failed';
    super(`AWS ${operation}: ${message}`, error);
    
    // Map AWS error codes to HTTP status codes
    if (error.name === 'ThrottlingException' || error.Code === 'RequestLimitExceeded') {
      this.statusCode = 429;
      this.code = 'AWS_RATE_LIMIT';
    } else if (error.name === 'UnauthorizedException' || error.Code === 'UnauthorizedOperation') {
      this.statusCode = 403;
      this.code = 'AWS_UNAUTHORIZED';
    } else if (error.name === 'ResourceNotFoundException') {
      this.statusCode = 404;
      this.code = 'AWS_RESOURCE_NOT_FOUND';
    }
  }
}

// Retry configuration
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ThrottlingException',
    'RequestLimitExceeded',
    'ServiceUnavailable',
    'RequestTimeout',
    'TooManyRequestsException',
    'ProvisionedThroughputExceededException',
  ],
};

// Retry logic with exponential backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...defaultRetryConfig, ...config };
  let lastError: any;
  
  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      const startTime = Date.now();
      const result = await operation();
      
      if (attempt > 1) {
        logger.info(`Operation succeeded after retry`, {
          operation: operationName,
          attempt,
          duration: Date.now() - startTime,
        });
      }
      
      return result;
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = retryConfig.retryableErrors?.some(
        retryableError => 
          error.name === retryableError || 
          error.Code === retryableError ||
          error.message?.includes(retryableError)
      );
      
      if (!isRetryable || attempt === retryConfig.maxAttempts) {
        logger.error(`Operation failed after ${attempt} attempts`, error, {
          operation: operationName,
          attempt,
          maxAttempts: retryConfig.maxAttempts,
        });
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        retryConfig.initialDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1),
        retryConfig.maxDelay
      );
      
      logger.warn(`Operation failed, retrying`, {
        operation: operationName,
        attempt,
        nextAttempt: attempt + 1,
        delay,
        error: error.message,
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Circuit breaker pattern
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private readonly name: string,
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000, // 1 minute
    private readonly logger: any = logger
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
        this.logger.info(`Circuit breaker half-open`, { name: this.name });
      } else {
        throw new AppError(
          `Circuit breaker is open for ${this.name}`,
          503,
          true,
          'CIRCUIT_BREAKER_OPEN'
        );
      }
    }
    
    try {
      const result = await operation();
      
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
        this.logger.info(`Circuit breaker closed`, { name: this.name });
      }
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'OPEN';
        this.logger.error(`Circuit breaker opened`, error, {
          name: this.name,
          failures: this.failures,
          threshold: this.threshold,
        });
      }
      
      throw error;
    }
  }
  
  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.logger.info(`Circuit breaker reset`, { name: this.name });
  }
}

// Global error handler for Express
export function globalErrorHandler(
  err: Error,
  req: any,
  res: any,
  next: any
) {
  if (err instanceof AppError) {
    logger.warn('Application error', {
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });
    
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  } else {
    // Unexpected errors
    logger.error('Unexpected error', err, {
      path: req.path,
      method: req.method,
      body: req.body,
      query: req.query,
    });
    
    // Don't expose internal errors in production
    const message = process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message;
    
    res.status(500).json({
      error: message,
      code: 'INTERNAL_ERROR',
    });
  }
}

// Async error wrapper for Express routes
export function asyncHandler(fn: Function) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Helper to handle AWS errors
export function handleAWSError(operation: string, error: any): never {
  throw new AWSError(operation, error);
}

// Helper to safely extract error message
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Unknown error';
}