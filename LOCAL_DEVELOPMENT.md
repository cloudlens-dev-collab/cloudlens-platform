# Local Development Setup

## Prerequisites

### Required Software
- **Node.js 20+** (recommended: use nvm)
- **PostgreSQL 16+** (or Docker for containerized database)
- **Git**

### Environment Setup
```bash
# Install Node.js 20 using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Verify versions
node --version  # Should be v20.x.x
npm --version   # Should be 10.x.x
```

## Project Setup

### 1. Clone and Install Dependencies
```bash
git clone <repository-url>
cd astraeus-cloud-platform
npm install
```

### 2. Database Setup

#### Option A: Local PostgreSQL
```bash
# Install PostgreSQL (Ubuntu/Debian)
sudo apt update
sudo apt install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE astraeus_dev;
CREATE USER astraeus_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE astraeus_dev TO astraeus_user;
\q
```

#### Option B: Docker PostgreSQL
```bash
# Run PostgreSQL in Docker
docker run --name astraeus-postgres \
  -e POSTGRES_DB=astraeus_dev \
  -e POSTGRES_USER=astraeus_user \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 \
  -d postgres:16
```

### 3. Environment Variables
Create `.env` file in project root:
```bash
# Database
DATABASE_URL="postgresql://astraeus_user:your_password@localhost:5432/astraeus_dev"
PGHOST=localhost
PGPORT=5432
PGUSER=astraeus_user
PGPASSWORD=your_password
PGDATABASE=astraeus_dev

# AI Services (Optional - add your API keys)
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key
PERPLEXITY_API_KEY=your_perplexity_key

# Cloud Provider Credentials (Optional)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_SESSION_TOKEN=your_aws_session_token

# Azure Credentials (Optional)
AZURE_CLIENT_ID=your_azure_client_id
AZURE_CLIENT_SECRET=your_azure_client_secret
```

### 4. Database Migration
```bash
# Push database schema
npm run db:push

# Verify database setup
npm run db:studio  # Opens Drizzle Studio for database inspection
```

## Development

### Available Scripts
```bash
# Development server (full-stack)
npm run dev              # Starts both frontend and backend

# Build for production
npm run build           # Creates optimized production build

# Database operations
npm run db:push         # Push schema changes to database
npm run db:studio       # Open database management UI
npm run db:migrate      # Run database migrations

# TypeScript compilation
npm run type-check      # Check TypeScript types
```

### Development Workflow
1. **Start development server**: `npm run dev`
2. **Frontend**: Available at `http://localhost:5000`
3. **Backend API**: Available at `http://localhost:5000/api`
4. **Database Studio**: `npm run db:studio` (usually `http://localhost:4983`)

### Hot Reload
- Frontend: Vite provides instant hot module replacement
- Backend: tsx watches for changes and restarts server automatically

## Project Structure

```
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── pages/       # Page components
│   │   ├── contexts/    # React contexts
│   │   ├── hooks/       # Custom React hooks
│   │   └── lib/         # Utilities and configurations
│   └── index.html
├── server/              # Express backend
│   ├── agents/          # LangGraph AI agents
│   ├── mcp/             # Model Context Protocol servers
│   ├── services/        # Cloud provider integrations
│   └── analysis/        # Cost optimization analysis
├── shared/              # Shared types and schemas
│   └── schema.ts        # Database schema definitions
└── package.json
```

## Dependencies Overview

### Core Framework
- **React 18** - Frontend framework
- **Express.js** - Backend web framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server

### Database & ORM
- **PostgreSQL** - Primary database
- **Drizzle ORM** - Type-safe database toolkit
- **@neondatabase/serverless** - Serverless PostgreSQL driver

### UI & Styling
- **Tailwind CSS** - Utility-first CSS framework
- **Radix UI** - Accessible component primitives
- **shadcn/ui** - Pre-built component library
- **Lucide React** - Icon library

### State Management
- **TanStack Query** - Server state management
- **React Hook Form** - Form handling
- **Zod** - Schema validation

### AI & LLM Integration
- **@anthropic-ai/sdk** - Claude AI integration
- **openai** - OpenAI GPT integration
- **@google/genai** - Google Gemini integration
- **@langchain/core** - LangChain framework
- **@langchain/langgraph** - Agent workflow orchestration

### Cloud Provider SDKs
- **@aws-sdk/client-*** - AWS service integrations
- **@azure/arm-*** - Azure Resource Manager
- **@azure/identity** - Azure authentication

### Development Tools
- **tsx** - TypeScript execution for development
- **drizzle-kit** - Database migration toolkit
- **@types/*** - TypeScript definitions

## Troubleshooting

### Common Issues

#### Database Connection Error
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list | grep postgres  # macOS

# Test connection
psql -h localhost -p 5432 -U astraeus_user -d astraeus_dev
```

#### Port Already in Use
```bash
# Find process using port 5000
lsof -i :5000
kill -9 <PID>

# Or use different port
PORT=3000 npm run dev
```

#### Node.js Version Issues
```bash
# Check current version
node --version

# Switch to Node 20
nvm use 20
npm install  # Reinstall dependencies
```

### Environment Variables Not Loading
- Ensure `.env` file is in project root
- Check file permissions: `chmod 644 .env`
- Restart development server after changes

### TypeScript Errors
```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
npm run type-check
```

## Production Deployment

### Build Process
```bash
# Create production build
npm run build

# Start production server
npm start
```

### Environment Requirements
- Node.js 20+
- PostgreSQL database
- All required environment variables set
- Cloud provider credentials (if using integrations)

## API Keys Setup

### Required for Full Functionality
1. **Database**: PostgreSQL connection (required)
2. **AI Services**: At least one LLM provider (optional)
3. **Cloud Providers**: AWS/Azure credentials for live data (optional)

### Optional Features
- Without AI keys: Platform works but chat/optimization features disabled
- Without cloud credentials: Platform works with sample data only
- All features work independently and gracefully degrade

## Performance Considerations

### Development
- Database queries are cached via TanStack Query
- Hot reload optimized for fast iteration
- TypeScript compilation in watch mode

### Production
- Vite optimizes frontend bundle size
- Express serves static files efficiently
- Database connections pooled
- API responses cached appropriately

## Security Notes

### Development
- Use strong database passwords
- Keep `.env` file out of version control
- Regularly update dependencies

### Production
- Use environment variables for secrets
- Enable HTTPS
- Implement proper CORS policies
- Regular security updates