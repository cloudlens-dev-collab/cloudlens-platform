/**
 * API Documentation for Astraeus Cloud Management Platform
 * 
 * This file contains comprehensive documentation for all API endpoints.
 * Generated documentation can be served at /api/docs
 */

export const apiDocumentation = {
  openapi: "3.0.0",
  info: {
    title: "Astraeus Cloud Management API",
    version: "2.0.0",
    description: "Enterprise-grade cloud resource management and cost optimization platform",
    contact: {
      name: "Astraeus Team",
      email: "support@astraeus.dev"
    }
  },
  servers: [
    {
      url: "http://localhost:5001",
      description: "Development server"
    }
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health check endpoint",
        description: "Returns the current health status of the API",
        responses: {
          "200": {
            description: "API is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "healthy" },
                    timestamp: { type: "string", format: "date-time" },
                    uptime: { type: "number", description: "Server uptime in seconds" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/accounts": {
      get: {
        summary: "List all cloud accounts",
        description: "Retrieve all configured cloud provider accounts",
        responses: {
          "200": {
            description: "List of accounts",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Account" }
                }
              }
            }
          }
        },
        tags: ["Accounts"]
      },
      post: {
        summary: "Create new cloud account",
        description: "Add a new cloud provider account for monitoring",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateAccountRequest" }
            }
          }
        },
        responses: {
          "201": {
            description: "Account created successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Account" }
              }
            }
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        },
        tags: ["Accounts"]
      }
    },
    "/api/accounts/{id}": {
      put: {
        summary: "Update cloud account",
        description: "Update an existing cloud account configuration",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Account ID"
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateAccountRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "Account updated successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Account" }
              }
            }
          },
          "404": {
            description: "Account not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        },
        tags: ["Accounts"]
      },
      delete: {
        summary: "Delete cloud account",
        description: "Remove a cloud account and all associated resources",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Account ID"
          }
        ],
        responses: {
          "204": { description: "Account deleted successfully" },
          "404": {
            description: "Account not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        },
        tags: ["Accounts"]
      }
    },
    "/api/accounts/{id}/sync": {
      post: {
        summary: "Sync account resources",
        description: "Trigger a full sync of resources and costs for the specified account",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Account ID"
          }
        ],
        responses: {
          "200": {
            description: "Sync completed successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    resourceCount: { type: "integer" },
                    duration: { type: "integer", description: "Sync duration in milliseconds" },
                    message: { type: "string" }
                  }
                }
              }
            }
          },
          "429": {
            description: "Rate limit exceeded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        },
        tags: ["Accounts"]
      }
    },
    "/api/resources": {
      get: {
        summary: "List cloud resources",
        description: "Get filtered and sorted list of cloud resources",
        parameters: [
          {
            name: "accountIds",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated list of account IDs to filter by"
          },
          {
            name: "search",
            in: "query",
            schema: { type: "string" },
            description: "Search term for resource name or ID"
          },
          {
            name: "provider",
            in: "query",
            schema: { type: "string", enum: ["aws", "azure", "gcp", "snowflake"] },
            description: "Filter by cloud provider"
          },
          {
            name: "type",
            in: "query",
            schema: { type: "string" },
            description: "Filter by resource type"
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string" },
            description: "Filter by resource status"
          },
          {
            name: "sortBy",
            in: "query",
            schema: { type: "string", default: "name" },
            description: "Field to sort by"
          },
          {
            name: "sortOrder",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"], default: "asc" },
            description: "Sort order"
          }
        ],
        responses: {
          "200": {
            description: "List of resources",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Resource" }
                }
              }
            }
          }
        },
        tags: ["Resources"]
      }
    },
    "/api/resources/{resourceId}/cost-breakdown": {
      get: {
        summary: "Get detailed cost breakdown",
        description: "Retrieve detailed cost analysis for a specific resource",
        parameters: [
          {
            name: "resourceId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Cloud provider resource ID"
          }
        ],
        responses: {
          "200": {
            description: "Cost breakdown data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CostBreakdown" }
              }
            }
          },
          "404": {
            description: "Resource not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        },
        tags: ["Resources", "Costs"]
      }
    },
    "/api/dashboard/summary": {
      get: {
        summary: "Get dashboard summary",
        description: "Retrieve key metrics and summary data for the dashboard",
        parameters: [
          {
            name: "accountIds",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated list of account IDs to include"
          }
        ],
        responses: {
          "200": {
            description: "Dashboard summary data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DashboardSummary" }
              }
            }
          }
        },
        tags: ["Dashboard"]
      }
    },
    "/api/chat": {
      post: {
        summary: "Send chat message",
        description: "Process a chat message using AI agents",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatMessage" }
            }
          }
        },
        responses: {
          "200": {
            description: "Chat response",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatResponse" }
              }
            }
          },
          "429": {
            description: "Rate limit exceeded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        },
        tags: ["Chat"]
      }
    },
    "/api/monitoring/metrics": {
      get: {
        summary: "Get system metrics",
        description: "Retrieve performance and monitoring metrics",
        responses: {
          "200": {
            description: "System metrics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cache: { type: "object", description: "Cache statistics" },
                    memory: { type: "object", description: "Memory usage" },
                    uptime: { type: "number", description: "Server uptime" }
                  }
                }
              }
            }
          }
        },
        tags: ["Monitoring"]
      }
    }
  },
  components: {
    schemas: {
      Account: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          provider: { type: "string", enum: ["aws", "azure", "gcp", "snowflake"] },
          accountId: { type: "string" },
          status: { type: "string", enum: ["active", "inactive", "error"] },
          createdAt: { type: "string", format: "date-time" },
          lastSyncAt: { type: "string", format: "date-time", nullable: true }
        }
      },
      CreateAccountRequest: {
        type: "object",
        required: ["name", "provider", "accountId", "credentials"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          provider: { type: "string", enum: ["aws", "azure", "gcp", "snowflake"] },
          accountId: { type: "string" },
          credentials: { type: "object", description: "Provider-specific credentials" }
        }
      },
      UpdateAccountRequest: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          status: { type: "string", enum: ["active", "inactive", "error"] },
          credentials: { type: "object", description: "Provider-specific credentials" }
        }
      },
      Resource: {
        type: "object",
        properties: {
          id: { type: "integer" },
          accountId: { type: "integer" },
          resourceId: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          provider: { type: "string" },
          status: { type: "string" },
          region: { type: "string", nullable: true },
          metadata: { type: "object", nullable: true },
          monthlyCost: { type: "string", nullable: true },
          costBreakdown: { type: "object", nullable: true },
          lastUpdated: { type: "string", format: "date-time" }
        }
      },
      CostBreakdown: {
        type: "object",
        properties: {
          resourceId: { type: "string" },
          totalCost: { type: "number" },
          services: { type: "object", additionalProperties: { type: "number" } },
          usageTypes: { type: "object", additionalProperties: { type: "number" } },
          dailyCosts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                service: { type: "string" },
                cost: { type: "number" }
              }
            }
          },
          period: { type: "string" },
          message: { type: "string" }
        }
      },
      DashboardSummary: {
        type: "object",
        properties: {
          totalAccounts: { type: "integer" },
          totalResources: { type: "integer" },
          activeResources: { type: "integer" },
          totalCost: { type: "string" },
          alertCount: { type: "integer" },
          criticalAlertCount: { type: "integer" },
          potentialSavings: { type: "string" },
          resourceBreakdown: { type: "object", additionalProperties: { type: "integer" } },
          costTrend: {
            type: "object",
            properties: {
              current: { type: "string" },
              previous: { type: "string" },
              percentChange: { type: "string" }
            }
          }
        }
      },
      ChatMessage: {
        type: "object",
        required: ["message", "sessionId"],
        properties: {
          message: { type: "string", minLength: 1, maxLength: 10000 },
          sessionId: { type: "string" },
          accountContext: { type: "array", items: { type: "integer" } },
          model: { type: "string", enum: ["openai", "claude", "gemini", "perplexity"] }
        }
      },
      ChatResponse: {
        type: "object",
        properties: {
          llmMetrics: {
            type: "object",
            properties: {
              model: { type: "string" },
              usage: { type: "object" },
              timestamp: { type: "string", format: "date-time" }
            }
          },
          assistantMessage: {
            type: "object",
            properties: {
              id: { type: "integer" },
              content: { type: "string" },
              followUps: { type: "array", items: { type: "string" } },
              searchResults: { type: "array" }
            }
          }
        }
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          details: { type: "object" }
        }
      }
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  },
  tags: [
    { name: "Accounts", description: "Cloud account management" },
    { name: "Resources", description: "Cloud resource operations" },
    { name: "Costs", description: "Cost analysis and optimization" },
    { name: "Dashboard", description: "Summary and analytics" },
    { name: "Chat", description: "AI-powered assistance" },
    { name: "Monitoring", description: "System health and metrics" }
  ]
};

export function generateApiDocs(): string {
  return `
# Astraeus Cloud Management API

## Overview
Enterprise-grade cloud resource management and cost optimization platform.

## Authentication
Currently using basic authentication. Bearer token authentication will be added in future versions.

## Rate Limiting
- General API: 100 requests per minute per IP
- Sync operations: 5 requests per hour per account
- Chat endpoints: 30 messages per minute per IP

## Response Format
All responses follow a consistent JSON format:

### Success Response
\`\`\`json
{
  "data": { ... },
  "message": "Success message (optional)"
}
\`\`\`

### Error Response
\`\`\`json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
\`\`\`

## Caching
The API implements intelligent caching:
- Account data: 5 minutes TTL
- Resource data: 5 minutes TTL
- Dashboard data: 2 minutes TTL
- Cost data: 15 minutes TTL
- Cost breakdowns: 30 minutes TTL

## Data Quality
All endpoints implement data validation and quality checks:
- Input validation using Zod schemas
- Data sanitization for security
- Quality monitoring with automatic alerts
- Comprehensive error handling

## Performance
- Response times monitored and logged
- Circuit breakers for external services
- Retry logic with exponential backoff
- Connection pooling and optimization

## Monitoring
System health endpoints available:
- \`/health\` - Basic health check
- \`/api/monitoring/metrics\` - Detailed metrics

For detailed endpoint documentation, see the OpenAPI specification.
  `;
}

// Express middleware to serve API documentation
export function apiDocsMiddleware() {
  return (req: any, res: any) => {
    if (req.accepts('json')) {
      res.json(apiDocumentation);
    } else {
      res.type('text/markdown').send(generateApiDocs());
    }
  };
}