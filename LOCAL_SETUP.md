# Astraeus Local Setup Guide

This guide helps you set up the Astraeus multi-cloud infrastructure management platform locally after downloading from Replit.

## Prerequisites

### Required Software
1. **Node.js 20+** - Download from [nodejs.org](https://nodejs.org/)
2. **PostgreSQL 16+** - Download from [postgresql.org](https://www.postgresql.org/download/)
3. **Git** - Download from [git-scm.com](https://git-scm.com/)

### API Keys Required
You'll need these API keys for full functionality:
- **OpenAI API Key** - Get from [platform.openai.com](https://platform.openai.com/api-keys)
- **Anthropic API Key** - Get from [console.anthropic.com](https://console.anthropic.com/)
- **AWS Credentials** - Access Key ID, Secret Access Key, Session Token
- **Azure Credentials** - Client ID, Client Secret, Tenant ID (optional)

## Installation Steps

### 1. Download and Extract
- Download the project as ZIP from Replit
- Extract to your desired directory
- Open terminal in the project directory

### 2. Install Dependencies
```bash
npm install
```

### 3. Database Setup

#### Option A: Local PostgreSQL
1. Install PostgreSQL and create a database:
```sql
CREATE DATABASE astraeus_db;
CREATE USER astraeus_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE astraeus_db TO astraeus_user;
```

2. Set your database URL:
```bash
DATABASE_URL="postgresql://astraeus_user:your_password@localhost:5432/astraeus_db"
```

#### Option B: Neon (Cloud PostgreSQL)
1. Create account at [neon.tech](https://neon.tech/)
2. Create a new project
3. Copy the connection string

### 4. Environment Variables
Create a `.env` file in the project root:

```env
# Database
DATABASE_URL="your_postgresql_connection_string"

# AI/LLM APIs
OPENAI_API_KEY="sk-your-openai-key"
ANTHROPIC_API_KEY="sk-ant-your-anthropic-key"
GEMINI_API_KEY="your-gemini-key"
PERPLEXITY_API_KEY="pplx-your-perplexity-key"

# AWS Credentials
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
AWS_SESSION_TOKEN="your-aws-session-token"

# Azure Credentials (Optional)
AZURE_CLIENT_ID="your-azure-client-id"
AZURE_CLIENT_SECRET="your-azure-client-secret"

# Development
NODE_ENV="development"
```

### 5. Database Migration
Push the database schema:
```bash
npm run db:push
```

### 6. Start Development Server
```bash
npm run dev
```

The application will be available at:
- **Frontend**: http://localhost:5000
- **API**: http://localhost:5000/api

## Features Available

### 1. Multi-Cloud Integration
- **AWS**: EC2, EBS, RDS, S3, Lambda discovery across all regions
- **Azure**: Virtual Machines, Storage, Databases (when configured)
- **Snowflake**: Data warehouse cost tracking

### 2. AI-Powered Analysis
- **LangGraph Agent**: Intelligent MCP tool selection
- **Multi-LLM Support**: OpenAI, Anthropic, Gemini, Perplexity
- **Natural Language Queries**: "Show me stopped instances in eu-central-1"

### 3. MCP Tools
- `get_resources`: Query infrastructure by type, region, status
- `get_costs`: Retrieve cost data and trends
- `get_resource_stats`: Infrastructure statistics and summaries
- `find_unattached_resources`: Identify cost optimization opportunities
- `get_alerts`: System alerts and notifications
- `get_accounts`: Account information and status

### 4. Dashboard Features
- Real-time cost tracking
- Resource inventory with sorting/filtering
- Performance metrics (IOPS, throughput)
- Alert management
- Multi-account support

## Testing the Setup

### 1. Verify Database Connection
```bash
npm run db:push
```
Should complete without errors.

### 2. Test API Endpoints
```bash
curl http://localhost:5000/api/accounts
curl http://localhost:5000/api/resources
```

### 3. Test AI Chat
Open the frontend and try queries like:
- "Show me list of EC2 instances in eu-central-1"
- "What are my stopped instances?"
- "Find unattached EBS volumes"

## Comprehensive Logging

The system provides detailed logging for all operations:
- **Request Analysis**: Query type detection
- **MCP Tool Calls**: Exact parameters and results
- **Database Queries**: Resource filtering and retrieval
- **LLM Responses**: Token usage and response generation

Example log output:
```
📥 CHAT REQUEST: User asked: "show me stopped instances"
🔍 QUERY ANALYSIS: Infrastructure query detected: true
🎯 AGENT: Using LangGraph agent with MCP tools
🔧 MCP TOOL CALL: get_resources with params: {"type": "ec2-instance", "status": "stopped"}
✅ MCP TOOL RESULT: 28 stopped instances found
📤 RESPONSE: Sent authentic database results
```

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify PostgreSQL is running
   - Check DATABASE_URL format
   - Ensure database exists

2. **API Keys Not Working**
   - Verify keys are correct in .env file
   - Check API key permissions
   - Restart development server after changes

3. **AWS/Azure Integration Issues**
   - Verify credentials have proper permissions
   - Check account access and regions
   - Review console logs for specific errors

4. **LangGraph Agent Timeout**
   - This is usually due to LLM rate limits
   - System automatically falls back to direct database access
   - Check logs for specific error messages

### Performance Tips

1. **Database Optimization**
   - Use connection pooling for production
   - Add indexes for frequently queried columns
   - Monitor query performance

2. **LLM Cost Optimization**
   - Use appropriate models for query complexity
   - Monitor token usage in logs
   - Cache frequent queries

3. **Resource Discovery**
   - Schedule regular syncs during off-peak hours
   - Use region filtering for faster queries
   - Monitor API rate limits

## Production Deployment

For production deployment:
1. Use environment-specific .env files
2. Configure proper database connection pooling
3. Set up monitoring and alerting
4. Use HTTPS and proper security headers
5. Configure backup and recovery procedures

## Support

The system includes comprehensive error handling and logging. Check the console logs for detailed information about any issues. All database operations are safe and non-destructive by default.