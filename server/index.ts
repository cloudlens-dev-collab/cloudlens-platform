import dotenv from "dotenv";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes-final";
import { setupVite, serveStatic, log } from "./vite";

// Load environment variables
dotenv.config();
console.log("🔧 Environment variables loaded");
// import { processManager, getProcessHealth } from "./process-manager.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Add health endpoint before routes
  app.get('/health', (_req: Request, res: Response) => {
    const memUsage = process.memoryUsage();
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      memory: {
        rss: Math.floor(memUsage.rss / 1024 / 1024),
        heapUsed: Math.floor(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.floor(memUsage.heapTotal / 1024 / 1024)
      },
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString()
    });
  });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    log(`Error ${status}: ${message}`);
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5001
  // this serves both the API and the client.
  const port = 5001;
  
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`Health check available at: http://localhost:${port}/health`);
    log(`Process Manager initialized with PID: ${process.pid}`);
  });

  // Handle server errors
  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      log(`Port ${port} is already in use`);
      process.exit(1);
    } else {
      log(`Server error: ${error.message}`);
    }
  });
})();
