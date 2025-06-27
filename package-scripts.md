# Package Scripts Guide

This document explains all available npm scripts in the Astraeus project.

## Development Scripts

### `npm run dev`
Starts the development server with hot reload:
- Runs both frontend (Vite) and backend (Express) on port 5000
- Includes TypeScript compilation with tsx
- Auto-restarts on file changes
- Serves the React frontend and API endpoints

### `npm run build`
Creates production build:
- Compiles TypeScript backend code
- Builds optimized React frontend bundle
- Generates static assets for deployment

### `npm run start`
Runs production server:
- Starts the compiled backend server
- Serves the built frontend from dist directory
- No hot reload (production mode)

## Database Scripts

### `npm run db:push`
Pushes database schema to PostgreSQL:
- Uses Drizzle Kit to sync schema changes
- Creates/updates tables based on shared/schema.ts
- Safe to run multiple times (idempotent)
- **Important**: Always run this after downloading the project

### `npm run db:generate`
Generates database migration files:
- Creates SQL migration files in drizzle directory
- Use when you modify the schema significantly
- Alternative to db:push for version-controlled migrations

### `npm run db:migrate`
Runs database migrations:
- Executes migration files in order
- Use with db:generate for production deployments
- More controlled than db:push

## Type Checking

### `npm run type-check`
Runs TypeScript compiler without emitting files:
- Checks for type errors across the project
- Useful for CI/CD pipelines
- Validates both frontend and backend TypeScript

## Linting and Formatting

### `npm run lint`
Runs ESLint on the codebase:
- Checks for code quality issues
- Enforces coding standards
- Includes both frontend and backend files

### `npm run format`
Formats code with Prettier:
- Automatically fixes formatting issues
- Ensures consistent code style
- Applies to TypeScript, JavaScript, and JSON files

## Utility Scripts

### `npm run clean`
Cleans build artifacts:
- Removes dist directory
- Clears node_modules/.cache
- Useful when troubleshooting build issues

### `npm run reset`
Complete project reset:
- Removes node_modules
- Clears all cache directories
- Forces fresh npm install
- Use when experiencing dependency issues

## Development Workflow

### Initial Setup
```bash
npm install
npm run db:push
npm run dev
```

### Daily Development
```bash
npm run dev          # Start development server
npm run type-check   # Check for type errors
npm run lint        # Check code quality
```

### Before Commit
```bash
npm run format      # Format code
npm run lint        # Final lint check
npm run type-check  # Ensure no type errors
npm run build       # Verify build works
```

### Production Deployment
```bash
npm run build       # Create production build
npm run start       # Start production server
```

## Environment-Specific Commands

### Development
```bash
NODE_ENV=development npm run dev
```

### Production
```bash
NODE_ENV=production npm run build
NODE_ENV=production npm run start
```

## Database Management

### Schema Changes
When you modify `shared/schema.ts`:
```bash
npm run db:push     # Push changes directly (development)
# OR
npm run db:generate # Generate migration files (production)
npm run db:migrate  # Apply migrations
```

### Fresh Database Setup
```bash
# Drop all tables and recreate
npm run db:push --force

# Or use migrations for clean setup
npm run db:generate
npm run db:migrate
```

## Troubleshooting Commands

### Build Issues
```bash
npm run clean
npm install
npm run build
```

### Type Errors
```bash
npm run type-check
# Fix reported errors in your IDE
```

### Database Issues
```bash
# Check database connection
npm run db:push

# Reset database schema
npm run db:push --force
```

### Dependency Issues
```bash
npm run reset
npm install
npm run dev
```

## Advanced Usage

### Custom Environment
```bash
# Load specific .env file
NODE_ENV=staging npm run dev

# Override specific variables
DATABASE_URL="custom_url" npm run dev
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=* npm run dev

# Backend only debug
DEBUG=server:* npm run dev
```

### Performance Profiling
```bash
# Enable Node.js profiling
NODE_OPTIONS="--inspect" npm run dev

# Memory analysis
NODE_OPTIONS="--heap-prof" npm run start
```

These scripts provide a complete development and deployment workflow for the Astraeus multi-cloud infrastructure management platform.