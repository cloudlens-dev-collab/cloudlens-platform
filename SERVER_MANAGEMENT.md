# Astraeus Server Management Guide

This guide provides comprehensive instructions for managing the Astraeus server to prevent connection issues and ensure reliable operation.

## 🚀 Quick Start

### Start Server (Recommended)
```bash
npm run server:start
```
This uses the robust startup script that handles all common issues automatically.

### Alternative Manual Start
```bash
npm run dev
```

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run server:start` | Start server with robust error handling |
| `npm run server:monitor` | Start continuous health monitoring |
| `npm run server:status` | Check current server status |
| `npm run server:cleanup` | Kill any processes on port 5001 |
| `npm run dev` | Standard development server |

## 🔧 Troubleshooting Connection Issues

### Problem: "Unable to connect" or "Connection refused"

**Solution 1: Use the robust startup script**
```bash
npm run server:cleanup
npm run server:start
```

**Solution 2: Manual cleanup and restart**
```bash
# Kill any processes on port 5001
lsof -ti:5001 | xargs kill -9

# Start the server
npm run dev
```

**Solution 3: Check for port conflicts**
```bash
# See what's running on port 5001
lsof -i:5001

# Find and kill specific process
kill -9 <PID>
```

### Problem: Server starts but crashes immediately

**Check the logs:**
```bash
tail -f server-debug.log
tail -f server-error.log
```

**Common solutions:**
1. **Database not running:**
   ```bash
   brew services start postgresql@14
   # or
   brew services start postgresql
   ```

2. **Port already in use:**
   ```bash
   npm run server:cleanup
   npm run server:start
   ```

3. **Node modules issues:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm run server:start
   ```

## 🏥 Health Monitoring

### Check Server Health
```bash
curl http://localhost:5001/health
```

Expected response:
```json
{
  "status": "healthy",
  "uptime": 12345,
  "memory": {
    "rss": 156,
    "heapUsed": 89,
    "heapTotal": 134
  },
  "restartCount": 0,
  "pid": 12345,
  "nodeVersion": "v20.x.x",
  "platform": "darwin"
}
```

### Continuous Monitoring
```bash
npm run server:monitor
```

This will:
- Check server health every 30 seconds
- Automatically restart if unhealthy
- Log all activities
- Send notifications on status changes

## 🛠 Server Features

### Process Manager
The server includes a built-in process manager that:
- Handles graceful shutdowns
- Monitors memory usage
- Logs health metrics
- Prevents memory leaks
- Handles uncaught exceptions

### Error Recovery
- Automatic restart on crashes (max 5 attempts)
- Graceful handling of database connection issues
- Port conflict detection and resolution
- Memory leak detection and warnings

### Logging
- Structured logging with timestamps
- Separate files for debug and error logs
- Health check logging
- Performance metrics

## 📊 Server Monitoring Dashboard

Access the monitoring dashboard at:
- Health: `http://localhost:5001/health`
- API Docs: `http://localhost:5001/api/docs`
- Main App: `http://localhost:5001`

## 🔄 Automatic Recovery

The server includes several layers of automatic recovery:

1. **Process Manager**: Handles crashes and restarts
2. **Health Monitoring**: Detects and resolves issues
3. **Startup Script**: Robust initialization with retries
4. **Database Recovery**: Automatic reconnection attempts

## 🚨 Common Issues and Solutions

### Issue: "EADDRINUSE: address already in use"
```bash
npm run server:cleanup
npm run server:start
```

### Issue: "Database connection failed"
```bash
# Start PostgreSQL
brew services start postgresql@14

# Check database status
pg_isready -h localhost -p 5432

# Restart server
npm run server:start
```

### Issue: "Module not found" errors
```bash
rm -rf node_modules package-lock.json
npm install
npm run server:start
```

### Issue: High memory usage
The server will automatically warn about high memory usage. If persistent:
```bash
# Restart the server
npm run server:cleanup
npm run server:start
```

## 🔐 Security Features

- Input validation on all endpoints
- Rate limiting (100 requests/minute)
- Error handling without exposing internals
- Graceful shutdown handling
- Process isolation

## 📈 Performance Optimization

The server includes:
- Connection pooling
- Response caching (configurable TTL)
- Request/response compression
- Memory usage monitoring
- Performance metrics logging

## 🎯 Best Practices

1. **Always use the startup script** (`npm run server:start`) for production-like reliability
2. **Monitor health regularly** with `npm run server:monitor`
3. **Check logs** if issues occur (`tail -f server-debug.log`)
4. **Use cleanup script** before starting if issues persist
5. **Keep dependencies updated** regularly

## 🆘 Emergency Procedures

### Complete Reset
```bash
# Stop everything
npm run server:cleanup

# Clean install
rm -rf node_modules package-lock.json
npm install

# Restart database
brew services restart postgresql@14

# Start server
npm run server:start
```

### Force Kill All Node Processes
```bash
sudo pkill -f node
sudo pkill -f tsx
npm run server:start
```

### Database Reset (if needed)
```bash
npm run db:push
npm run server:start
```

## 📞 Support

If you continue to experience issues:

1. Check the logs: `server-debug.log` and `server-error.log`
2. Verify database is running: `pg_isready -h localhost -p 5432`
3. Check for port conflicts: `lsof -i:5001`
4. Try the complete reset procedure above

The robust startup and monitoring scripts should handle 99% of connection issues automatically.