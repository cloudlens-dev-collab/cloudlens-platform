#!/bin/bash

# Astraeus Server Startup Script
# This script ensures robust server startup and prevents connection issues

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PORT=5001
PROJECT_DIR="/Users/tejachavali/Astraeus"
MAX_RETRIES=3
RETRY_DELAY=5

echo -e "${BLUE}🚀 Starting Astraeus Cloud Management Platform${NC}"
echo "================================================"

# Function to log messages
log() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%H:%M:%S')] ERROR:${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date +'%H:%M:%S')] WARNING:${NC} $1"
}

# Function to kill processes on port
kill_port_processes() {
    local port=$1
    log "Checking for processes on port $port..."
    
    local pids=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
        warn "Found processes running on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 2
        log "Processes killed"
    else
        log "No processes found on port $port"
    fi
}

# Function to check if server is healthy
check_health() {
    local max_attempts=10
    local attempt=1
    
    log "Waiting for server to be healthy..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
            log "✅ Server is healthy and responding"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    error "Server failed to become healthy after $max_attempts attempts"
    return 1
}

# Function to start database
start_database() {
    log "Checking PostgreSQL database..."
    
    # Check if PostgreSQL is running
    if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
        warn "PostgreSQL is not running. Attempting to start..."
        
        # Try different ways to start PostgreSQL
        if command -v brew > /dev/null 2>&1; then
            brew services start postgresql@14 || brew services start postgresql || true
        elif command -v systemctl > /dev/null 2>&1; then
            sudo systemctl start postgresql || true
        elif command -v service > /dev/null 2>&1; then
            sudo service postgresql start || true
        fi
        
        # Wait for PostgreSQL to start
        for i in {1..10}; do
            if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
                log "✅ PostgreSQL is now running"
                break
            fi
            sleep 2
        done
        
        if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
            error "Failed to start PostgreSQL. Please start it manually:"
            error "  brew services start postgresql@14"
            error "  or brew services start postgresql"
            exit 1
        fi
    else
        log "✅ PostgreSQL is already running"
    fi
}

# Function to start the server
start_server() {
    local attempt=1
    
    while [ $attempt -le $MAX_RETRIES ]; do
        log "Starting server (attempt $attempt/$MAX_RETRIES)..."
        
        # Kill any existing processes on port
        kill_port_processes $PORT
        
        # Change to project directory
        cd "$PROJECT_DIR" || {
            error "Failed to change to project directory: $PROJECT_DIR"
            exit 1
        }
        
        # Check if node_modules exists
        if [ ! -d "node_modules" ]; then
            log "Installing dependencies..."
            npm install || {
                error "Failed to install dependencies"
                exit 1
            }
        fi
        
        # Start the database
        start_database
        
        # Start the server in background
        log "Launching server..."
        npm run dev > server-debug.log 2> server-error.log &
        SERVER_PID=$!
        
        # Store PID for cleanup
        echo $SERVER_PID > .server.pid
        
        # Wait for server to start
        sleep 5
        
        # Check if server is healthy
        if check_health; then
            log "🎉 Server started successfully!"
            log "Server PID: $SERVER_PID"
            log "Access the application at: http://localhost:$PORT"
            log "Press Ctrl+C to stop the server"
            
            # Function to cleanup on exit
            cleanup() {
                log "Shutting down server..."
                if [ -f ".server.pid" ]; then
                    local pid=$(cat .server.pid)
                    kill $pid 2>/dev/null || true
                    rm -f .server.pid
                fi
                kill_port_processes $PORT
                log "Server stopped"
                exit 0
            }
            
            # Set up signal handlers
            trap cleanup SIGINT SIGTERM
            
            # Keep script running and monitor server
            while true; do
                if ! kill -0 $SERVER_PID 2>/dev/null; then
                    error "Server process died unexpectedly"
                    break
                fi
                sleep 10
            done
            
            return 0
        else
            error "Server failed to start properly (attempt $attempt)"
            
            # Kill the failed process
            kill $SERVER_PID 2>/dev/null || true
            kill_port_processes $PORT
            
            if [ $attempt -lt $MAX_RETRIES ]; then
                warn "Retrying in $RETRY_DELAY seconds..."
                sleep $RETRY_DELAY
            fi
        fi
        
        attempt=$((attempt + 1))
    done
    
    error "Failed to start server after $MAX_RETRIES attempts"
    exit 1
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  --help, -h     Show this help message"
    echo "  --cleanup, -c  Kill any processes on port $PORT and exit"
    echo "  --status, -s   Check server status"
    echo ""
}

# Function to show status
show_status() {
    log "Checking server status..."
    
    local pids=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$pids" ]; then
        log "Processes on port $PORT: $pids"
        
        if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
            log "✅ Server is running and healthy"
        else
            warn "Server process exists but not responding to health checks"
        fi
    else
        log "No processes found on port $PORT"
    fi
}

# Parse command line arguments
case "${1:-}" in
    --help|-h)
        show_usage
        exit 0
        ;;
    --cleanup|-c)
        log "Cleaning up processes on port $PORT..."
        kill_port_processes $PORT
        log "Cleanup complete"
        exit 0
        ;;
    --status|-s)
        show_status
        exit 0
        ;;
    "")
        # Default action: start server
        start_server
        ;;
    *)
        error "Unknown option: $1"
        show_usage
        exit 1
        ;;
esac