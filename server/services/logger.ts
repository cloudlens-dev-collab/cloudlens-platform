import winston from 'winston';
import { format } from 'winston';

const { combine, timestamp, errors, json, prettyPrint, colorize, printf } = format;

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Create format for console output
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}] ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    // Pretty print metadata if it exists
    const metaStr = JSON.stringify(metadata, null, 2);
    if (metaStr !== '{}') {
      msg += `\n${metaStr}`;
    }
  }
  
  return msg;
});

// Create format for file output
const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  json()
);

// Create format for development
const devFormat = combine(
  timestamp({ format: 'HH:mm:ss' }),
  colorize(),
  consoleFormat
);

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

// Create transports
const transports: winston.transport[] = [];

if (!isTest) {
  // Console transport for development
  if (isDevelopment) {
    transports.push(
      new winston.transports.Console({
        format: devFormat,
      })
    );
  }

  // File transports for all environments
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );

  // Add production console transport
  if (!isDevelopment) {
    transports.push(
      new winston.transports.Console({
        format: fileFormat,
      })
    );
  }
}

// Create logger instance
const logger = winston.createLogger({
  level: isDevelopment ? 'debug' : 'info',
  levels,
  transports,
});

// Export logger with structured logging methods
export class Logger {
  private context: string;
  private metadata: Record<string, any>;

  constructor(context: string, metadata?: Record<string, any>) {
    this.context = context;
    this.metadata = metadata || {};
  }

  private log(level: string, message: string, meta?: Record<string, any>) {
    logger.log(level, message, {
      context: this.context,
      ...this.metadata,
      ...meta,
    });
  }

  // Core logging methods
  error(message: string, error?: Error | any, meta?: Record<string, any>) {
    this.log('error', message, {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
      ...meta,
    });
  }

  warn(message: string, meta?: Record<string, any>) {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: Record<string, any>) {
    this.log('info', message, meta);
  }

  http(message: string, meta?: Record<string, any>) {
    this.log('http', message, meta);
  }

  debug(message: string, meta?: Record<string, any>) {
    this.log('debug', message, meta);
  }

  // Specialized logging methods
  apiRequest(method: string, path: string, meta?: Record<string, any>) {
    this.http(`${method} ${path}`, {
      method,
      path,
      type: 'api_request',
      ...meta,
    });
  }

  apiResponse(method: string, path: string, statusCode: number, duration: number, meta?: Record<string, any>) {
    const level = statusCode >= 400 ? 'warn' : 'http';
    this.log(level, `${method} ${path} ${statusCode} in ${duration}ms`, {
      method,
      path,
      statusCode,
      duration,
      type: 'api_response',
      ...meta,
    });
  }

  awsApiCall(service: string, operation: string, meta?: Record<string, any>) {
    this.debug(`AWS ${service} - ${operation}`, {
      service,
      operation,
      type: 'aws_api_call',
      ...meta,
    });
  }

  awsApiSuccess(service: string, operation: string, duration: number, meta?: Record<string, any>) {
    this.info(`AWS ${service} - ${operation} completed in ${duration}ms`, {
      service,
      operation,
      duration,
      type: 'aws_api_success',
      ...meta,
    });
  }

  awsApiError(service: string, operation: string, error: Error | any, meta?: Record<string, any>) {
    this.error(`AWS ${service} - ${operation} failed`, error, {
      service,
      operation,
      type: 'aws_api_error',
      ...meta,
    });
  }

  dataQuality(issue: string, details: any) {
    this.warn(`Data quality issue: ${issue}`, {
      issue,
      details,
      type: 'data_quality',
    });
  }

  performance(operation: string, duration: number, meta?: Record<string, any>) {
    const level = duration > 5000 ? 'warn' : 'info';
    this.log(level, `Performance: ${operation} took ${duration}ms`, {
      operation,
      duration,
      type: 'performance',
      slow: duration > 5000,
      ...meta,
    });
  }

  sync(accountName: string, status: 'started' | 'completed' | 'failed', meta?: Record<string, any>) {
    const level = status === 'failed' ? 'error' : 'info';
    this.log(level, `Sync ${status} for account: ${accountName}`, {
      accountName,
      status,
      type: 'sync',
      ...meta,
    });
  }

  costData(operation: string, meta?: Record<string, any>) {
    this.info(`Cost data operation: ${operation}`, {
      operation,
      type: 'cost_data',
      ...meta,
    });
  }

  security(event: string, meta?: Record<string, any>) {
    this.warn(`Security event: ${event}`, {
      event,
      type: 'security',
      ...meta,
    });
  }

  // Create child logger with additional context
  child(additionalContext: string, additionalMetadata?: Record<string, any>): Logger {
    return new Logger(
      `${this.context}:${additionalContext}`,
      { ...this.metadata, ...additionalMetadata }
    );
  }
}

// Export a default logger instance
export const defaultLogger = new Logger('App');

// Export function to create context-specific loggers
export function createLogger(context: string, metadata?: Record<string, any>): Logger {
  return new Logger(context, metadata);
}

// Middleware for Express request logging
export function requestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    const requestLogger = new Logger('HTTP', {
      requestId: Math.random().toString(36).substring(7),
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Log request
    requestLogger.apiRequest(req.method, req.path, {
      query: req.query,
      body: req.body,
    });

    // Capture response
    const originalSend = res.send;
    res.send = function(data: any) {
      res.send = originalSend;
      const duration = Date.now() - start;
      
      requestLogger.apiResponse(req.method, req.path, res.statusCode, duration, {
        contentLength: res.get('content-length'),
      });

      return res.send(data);
    };

    next();
  };
}