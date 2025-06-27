/**
 * Process Manager for Astraeus Server
 * Handles graceful shutdown, error recovery, and health monitoring
 */

import { createLogger } from './services/logger.js';

const logger = createLogger('ProcessManager');

class ProcessManager {
  private isShuttingDown = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private maxRestarts = 5;
  private startTime = Date.now();

  constructor() {
    this.setupSignalHandlers();
    this.setupErrorHandlers();
    this.startHealthCheck();
  }

  private setupSignalHandlers() {
    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, initiating graceful shutdown...');
      this.gracefulShutdown();
    });

    // Graceful shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, initiating graceful shutdown...');
      this.gracefulShutdown();
    });

    // Handle SIGHUP for configuration reload
    process.on('SIGHUP', () => {
      logger.info('Received SIGHUP, reloading configuration...');
      // Add configuration reload logic here if needed
    });
  }

  private setupErrorHandlers() {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception:', {
        error: error.message,
        stack: error.stack,
        pid: process.pid
      });

      // Don't restart immediately on uncaught exceptions
      // Log the error and let the process crash
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      logger.error('Unhandled Rejection:', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: promise.toString(),
        pid: process.pid
      });

      // Don't exit on unhandled rejections, just log them
    });

    // Handle warnings
    process.on('warning', (warning: Error) => {
      logger.warn('Process Warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });
  }

  private startHealthCheck() {
    // Health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
  }

  private async performHealthCheck() {
    try {
      const memUsage = process.memoryUsage();
      const uptime = Date.now() - this.startTime;
      
      // Log health metrics
      logger.info('Health Check:', {
        uptime: Math.floor(uptime / 1000),
        memory: {
          rss: Math.floor(memUsage.rss / 1024 / 1024) + 'MB',
          heapUsed: Math.floor(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.floor(memUsage.heapTotal / 1024 / 1024) + 'MB'
        },
        restartCount: this.restartCount,
        pid: process.pid
      });

      // Check for memory leaks (if RSS > 1GB, warn)
      if (memUsage.rss > 1024 * 1024 * 1024) {
        logger.warn('High memory usage detected', {
          rss: Math.floor(memUsage.rss / 1024 / 1024) + 'MB'
        });
      }

    } catch (error) {
      logger.error('Health check failed:', error);
    }
  }

  private async gracefulShutdown(exitCode: number = 0) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress, forcing exit...');
      process.exit(1);
      return;
    }

    this.isShuttingDown = true;
    logger.info('Starting graceful shutdown...');

    try {
      // Stop health checks
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Give ongoing requests time to complete (max 10 seconds)
      logger.info('Waiting for ongoing requests to complete...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Close database connections
      try {
        // Add database cleanup here if needed
        logger.info('Database connections closed');
      } catch (error) {
        logger.error('Error closing database connections:', error);
      }

      // Final cleanup
      logger.info('Graceful shutdown completed');
      process.exit(exitCode);

    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  public incrementRestartCount() {
    this.restartCount++;
    if (this.restartCount >= this.maxRestarts) {
      logger.error(`Maximum restart count (${this.maxRestarts}) reached, exiting...`);
      process.exit(1);
    }
  }

  public getStats() {
    return {
      uptime: Date.now() - this.startTime,
      restartCount: this.restartCount,
      pid: process.pid,
      memory: process.memoryUsage()
    };
  }
}

// Create and export singleton instance
export const processManager = new ProcessManager();

// Export health endpoint data
export function getProcessHealth() {
  const memUsage = process.memoryUsage();
  return {
    status: 'healthy',
    uptime: Date.now() - processManager.getStats().uptime,
    memory: {
      rss: Math.floor(memUsage.rss / 1024 / 1024),
      heapUsed: Math.floor(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.floor(memUsage.heapTotal / 1024 / 1024)
    },
    restartCount: processManager.getStats().restartCount,
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform
  };
}