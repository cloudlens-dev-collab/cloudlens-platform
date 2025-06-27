import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from "../shared/schema";

// Robust database URL handling
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://astraeus_user:badsin@localhost:5432/astraeus_dev";

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

console.log("🔌 Database connecting to:", DATABASE_URL.replace(/:[^:@]*@/, ':****@'));

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.connect()
  .then(client => {
    console.log("✅ Database connected successfully");
    client.release();
  })
  .catch(err => {
    console.error("❌ Database connection failed:", err.message);
    console.error("🔧 Check that PostgreSQL is running on localhost:5432");
    console.error("🔧 Check that database 'astraeus_dev' exists");
    console.error("🔧 Check that user 'astraeus_user' has access");
  });

export const db = drizzle(pool, { schema });
