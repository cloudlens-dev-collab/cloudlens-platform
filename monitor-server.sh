#!/bin/bash

# Astraeus Server Monitor Script
# Monitors server health and automatically restarts if needed

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PORT=5001
PROJECT_DIR="/Users/tejachavali/Astraeus"
CHECK_INTERVAL=30  # Check every 30 seconds
MAX_FAILURES=3     # Max consecutive failures before restart

log() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%H:%M:%S')] ERROR:${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date +'%H:%M:%S')] WARNING:${NC} $1"
}

# Function to check if server is healthy
check_server_health() {
    local response=$(curl -s -w "%{http_code}" http://localhost:$PORT/health -o /dev/null 2>/dev/null)
    
    if [ "$response" = "200" ]; then
        return 0  # Healthy
    else
        return 1  # Unhealthy
    fi
}

# Function to get server process info
get_server_process() {
    lsof -ti:$PORT 2>/dev/null | head -1
}

# Function to restart server
restart_server() {
    warn "Restarting server..."
    
    # Kill existing processes
    local pids=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 3
    fi
    
    # Change to project directory
    cd "$PROJECT_DIR" || {
        error "Failed to change to project directory"
        return 1
    }
    
    # Start server in background
    log "Starting server..."
    npm run dev > server-debug.log 2> server-error.log &
    local new_pid=$!
    
    # Wait for server to start
    sleep 10
    
    # Check if it's healthy
    if check_server_health; then
        log "✅ Server restarted successfully (PID: $new_pid)"
        return 0
    else
        error "Server restart failed"
        return 1
    fi
}

# Function to send status notification
send_notification() {
    local status="$1"
    local message="$2"
    
    # You can extend this to send notifications via email, Slack, etc.
    echo -e "${BLUE}[NOTIFICATION]${NC} $status: $message"
}

# Main monitoring loop
monitor_server() {
    local failure_count=0
    local last_status="unknown"
    
    log "🔍 Starting Astraeus server monitoring..."
    log "Port: $PORT"
    log "Check interval: ${CHECK_INTERVAL}s"
    log "Max failures before restart: $MAX_FAILURES"
    echo ""
    
    while true; do
        if check_server_health; then
            # Server is healthy
            if [ "$last_status" != "healthy" ]; then
                log "✅ Server is healthy"
                if [ "$last_status" = "unhealthy" ]; then
                    send_notification "RECOVERED" "Server is now responding normally"
                fi
                last_status="healthy"
            fi
            failure_count=0
        else
            # Server is unhealthy
            failure_count=$((failure_count + 1))
            
            if [ "$last_status" != "unhealthy" ]; then
                warn "❌ Server health check failed"
                last_status="unhealthy"
            fi
            
            local process_pid=$(get_server_process)
            if [ -n "$process_pid" ]; then
                warn "Server process exists (PID: $process_pid) but not responding to health checks"
            else
                warn "No server process found on port $PORT"
            fi
            
            if [ $failure_count -ge $MAX_FAILURES ]; then
                error "Server failed $failure_count consecutive health checks"
                send_notification "CRITICAL" "Server is down, attempting restart..."
                
                if restart_server; then
                    failure_count=0
                    send_notification "SUCCESS" "Server restart completed"
                else
                    error "Failed to restart server, will try again in next cycle"
                    send_notification "FAILED" "Server restart failed"
                fi
            else
                warn "Health check failure $failure_count/$MAX_FAILURES"
            fi
        fi
        
        sleep $CHECK_INTERVAL
    done
}

# Function to show current status
show_status() {
    log "Checking server status..."
    
    local process_pid=$(get_server_process)
    if [ -n "$process_pid" ]; then
        log "Process running on port $PORT (PID: $process_pid)"
        
        if check_server_health; then
            log "✅ Server is healthy and responding"
        else
            warn "❌ Server process exists but not responding to health checks"
        fi
    else
        warn "No process found on port $PORT"
    fi
}

# Handle command line arguments
case "${1:-}" in
    --help|-h)
        echo "Astraeus Server Monitor"
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --status, -s   Check current server status"
        echo "  --once, -o     Run health check once and exit"
        echo ""
        echo "Default: Start continuous monitoring"
        exit 0
        ;;
    --status|-s)
        show_status
        exit 0
        ;;
    --once|-o)
        if check_server_health; then
            log "✅ Server is healthy"
            exit 0
        else
            error "❌ Server is unhealthy"
            exit 1
        fi
        ;;
    "")
        # Default: start monitoring
        monitor_server
        ;;
    *)
        error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac