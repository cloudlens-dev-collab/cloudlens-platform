# Astraeus System Architecture

This document provides a comprehensive overview of the Astraeus multi-cloud infrastructure management platform architecture.

## High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │    │  Express API    │    │   PostgreSQL    │
│   (Frontend)    │◄──►│   (Backend)     │◄──►│   (Database)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   MCP Servers   │
                    │ (Tool Execution)│
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐    ┌─────────────────┐
                    │  Cloud APIs     │    │   LLM APIs      │
                    │ (AWS/Azure)     │    │ (OpenAI/Claude) │
                    └─────────────────┘    └─────────────────┘
```

## Frontend Architecture

### Technology Stack
- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **Wouter** for lightweight client-side routing
- **TanStack Query** for server state management
- **shadcn/ui + Radix UI** for component library
- **Tailwind CSS** for styling

### Key Components

#### Pages
- `Dashboard.tsx` - Main overview with cost summaries and trends
- `Resources.tsx` - Resource inventory with filtering and sorting
- `Costs.tsx` - Cost analysis and trend visualization
- `Chat.tsx` - AI-powered infrastructure analysis
- `Accounts.tsx` - Multi-cloud account management

#### Shared Components
- `ui/` - shadcn/ui components (Button, Card, Dialog, etc.)
- `contexts/` - React contexts for global state
- `hooks/` - Custom React hooks for API interactions

### State Management
- **TanStack Query** for server state caching and synchronization
- **React Context** for user preferences and global UI state
- **Local State** for component-specific interactions

## Backend Architecture

### Core Services

#### API Layer (`server/routes.ts`)
- RESTful endpoints for all frontend operations
- Request validation with Zod schemas
- Comprehensive logging for debugging
- Error handling with proper HTTP status codes

#### Storage Layer (`server/storage.ts`)
- Interface-based design for flexible storage backends
- Database storage implementation with Drizzle ORM
- Support for complex queries and relationships
- Safe operations with transaction support

#### MCP (Model Context Protocol) System
```
┌─────────────────────┐
│   MCP Manager       │
│                     │
├─────────────────────┤
│ Infrastructure      │ ← get_resources, get_costs, get_stats
│ Server              │
├─────────────────────┤
│ Cloud Sync          │ ← sync_resources, validate_credentials
│ Server              │
├─────────────────────┤
│ LLM Analytics       │ ← analyze_usage, optimize_models
│ Server              │
└─────────────────────┘
```

#### LangGraph Agent
- Intelligent tool selection based on natural language
- No hardcoded logic or regex parsing
- Comprehensive logging of tool execution
- Fallback mechanisms for reliability

### Cloud Integration

#### AWS Service (`server/services/aws.ts`)
- **Multi-region discovery**: All AWS regions supported
- **Service coverage**: EC2, EBS, RDS, S3, Lambda, VPC, Security Groups
- **Cost integration**: Cost Explorer API for billing data
- **Performance metrics**: Instance types, IOPS, throughput calculations

#### Azure Service (`server/services/azure.ts`)
- **Subscription-wide discovery**: All resource types
- **Authentication**: Service principal and device code support
- **Resource types**: VMs, Storage, Databases, Networking
- **Cost tracking**: Consumption API integration

#### Snowflake Service (`server/services/snowflake.ts`)
- **Data warehouse integration**: Cost and usage tracking
- **Query performance**: Warehouse utilization metrics
- **Credit consumption**: Detailed billing analysis

### LLM Integration

#### Multi-Provider Support
```
LLM Service
├── OpenAI (GPT-4o) - Primary for tool execution
├── Anthropic (Claude) - Advanced reasoning
├── Google Gemini - Multimodal analysis
└── Perplexity - Research and citations
```

#### Intelligent Model Selection
- **Query complexity analysis**: Simple vs complex routing
- **Cost optimization**: Appropriate model for task
- **Rate limit handling**: Automatic fallback strategies
- **Usage tracking**: Token consumption monitoring

## Database Schema

### Core Tables

#### Users
```sql
users (
  id SERIAL PRIMARY KEY,
  username VARCHAR UNIQUE,
  email VARCHAR,
  created_at TIMESTAMP
)
```

#### Accounts
```sql
accounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR,
  provider VARCHAR, -- 'aws', 'azure', 'snowflake'
  credentials JSONB, -- Encrypted credentials
  metadata JSONB,
  created_at TIMESTAMP
)
```

#### Resources
```sql
resources (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  resource_id VARCHAR, -- Cloud provider resource ID
  name VARCHAR,
  type VARCHAR, -- 'ec2-instance', 'ebs-volume', etc.
  region VARCHAR,
  status VARCHAR,
  monthly_cost DECIMAL,
  metadata JSONB, -- Provider-specific data
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

#### Costs
```sql
costs (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  service VARCHAR,
  amount DECIMAL,
  currency VARCHAR DEFAULT 'USD',
  billing_period DATE,
  metadata JSONB,
  created_at TIMESTAMP
)
```

#### Alerts
```sql
alerts (
  id SERIAL PRIMARY KEY,
  account_id INTEGER,
  type VARCHAR, -- 'cost_threshold', 'resource_anomaly'
  message TEXT,
  severity VARCHAR,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP
)
```

#### Chat Messages
```sql
chat_messages (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR,
  role VARCHAR, -- 'user', 'assistant'
  content TEXT,
  model VARCHAR,
  account_context VARCHAR,
  usage JSONB, -- Token usage data
  created_at TIMESTAMP
)
```

## Data Flow

### Resource Discovery
1. **Cloud Sync MCP Server** authenticates with cloud providers
2. **Multi-region scanning** discovers all resources
3. **Metadata extraction** captures performance data
4. **Database storage** via Drizzle ORM with upsert logic
5. **Real-time updates** through dashboard APIs

### AI Query Processing
1. **Query analysis** determines if infrastructure-related
2. **LangGraph agent** selects appropriate MCP tools
3. **Tool execution** retrieves authentic database data
4. **LLM processing** with filtered, relevant data
5. **Response generation** with comprehensive logging

### Cost Tracking
1. **Billing API integration** (AWS Cost Explorer, Azure Consumption)
2. **Daily cost collection** with historical data
3. **Trend analysis** and anomaly detection
4. **Alert generation** for threshold breaches
5. **Dashboard visualization** with interactive charts

## Security Architecture

### Authentication & Authorization
- User authentication with secure sessions
- API key management for cloud providers
- Encrypted credential storage in database
- Role-based access control (planned)

### Data Protection
- Environment variable isolation
- Database connection encryption
- API rate limiting and throttling
- Input validation and sanitization

### Cloud Security
- IAM role-based cloud access
- Minimum required permissions
- Credential rotation support
- Audit logging for all operations

## Performance Optimizations

### Frontend
- **Code splitting**: Route-based lazy loading
- **Query caching**: TanStack Query with stale-while-revalidate
- **Bundle optimization**: Vite's advanced tree shaking
- **Asset optimization**: Image compression and lazy loading

### Backend
- **Database indexing**: Optimized queries for large datasets
- **Connection pooling**: Efficient database connections
- **Response caching**: API response caching for static data
- **Batch processing**: Bulk resource discovery operations

### LLM Integration
- **Smart fallbacks**: Multiple provider support
- **Token optimization**: Context-aware prompt engineering
- **Rate limit handling**: Graceful degradation
- **Usage monitoring**: Cost and performance tracking

## Monitoring & Observability

### Comprehensive Logging
```
Request Flow Logging:
📥 CHAT REQUEST: User query received
🔍 QUERY ANALYSIS: Infrastructure query detected
🎯 AGENT: Using LangGraph agent
🔧 MCP TOOL CALL: Specific tool and parameters
✅ MCP TOOL RESULT: Authentic database results
📤 RESPONSE: Final response to user
```

### Error Handling
- Graceful degradation for service failures
- Detailed error logging with stack traces
- User-friendly error messages
- Automatic retry mechanisms

### Performance Metrics
- API response times
- Database query performance
- LLM token usage and costs
- Resource discovery efficiency

## Scalability Considerations

### Horizontal Scaling
- Stateless API design for load balancing
- Database connection pooling
- Background job processing for resource discovery
- CDN integration for static assets

### Vertical Scaling
- Efficient database queries with proper indexing
- Memory-optimized data structures
- Streaming for large datasets
- Lazy loading for UI components

## Development Workflow

### Local Development
1. Clone repository
2. Install dependencies (`npm install`)
3. Set up environment variables
4. Initialize database (`npm run db:push`)
5. Start development server (`npm run dev`)

### Production Deployment
1. Build optimization (`npm run build`)
2. Database migrations (`npm run db:migrate`)
3. Environment configuration
4. Health checks and monitoring setup
5. Load balancer configuration

This architecture provides a solid foundation for a production-ready multi-cloud infrastructure management platform with comprehensive AI integration and real-time data processing capabilities.