#!/bin/bash

# Quick Fix Script for Astraeus Connection Issues
# Run this script whenever you see "unable to connect" errors

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔧 Astraeus Connection Fix Script${NC}"
echo "=================================="

# Step 1: Kill any hanging processes
echo -e "${YELLOW}Step 1: Cleaning up hanging processes...${NC}"
pkill -f "tsx server/index.ts" 2>/dev/null || true
pids=$(lsof -ti:5001 2>/dev/null || true)
if [ -n "$pids" ]; then
    echo "Killing processes: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Step 2: Check database
echo -e "${YELLOW}Step 2: Checking database...${NC}"
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo "Starting PostgreSQL..."
    brew services start postgresql@14 || brew services start postgresql
    sleep 3
fi

# Step 3: Start server
echo -e "${YELLOW}Step 3: Starting server...${NC}"
cd /Users/tejachavali/Astraeus
npm run dev > server-debug.log 2> server-error.log &
SERVER_PID=$!

# Step 4: Wait and verify
echo -e "${YELLOW}Step 4: Waiting for server to start...${NC}"
sleep 8

# Test health endpoint
for i in {1..10}; do
    if curl -s http://localhost:5001/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Server is running successfully!${NC}"
        echo -e "${GREEN}🌐 Access at: http://localhost:5001${NC}"
        echo -e "${GREEN}📊 Health: http://localhost:5001/health${NC}"
        echo -e "${GREEN}🆔 Server PID: $SERVER_PID${NC}"
        exit 0
    fi
    echo -n "."
    sleep 2
done

echo -e "${RED}❌ Server failed to start. Check logs:${NC}"
echo "  tail -f server-debug.log"
echo "  tail -f server-error.log"
exit 1