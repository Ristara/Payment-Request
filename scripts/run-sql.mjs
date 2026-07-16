#!/usr/bin/env node
// Run a single SQL file (or all unapplied migration files) against the
// Supabase Postgres database. Used as an alternative to pasting SQL into
// the Supabase SQL editor.
//
// Usage:
//   node --env-file=.env.local scripts/run-sql.mjs <path-to-sql>
//   node --env-file=.env.local scripts/run-sql.mjs supabase/migrations/002_fix_role_uniqueness.sql

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: node scripts/run-sql.mjs <path-to-sql>");
  process.exit(1);
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error("File not found:", filePath);
  process.exit(1);
}

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL not set. Use --env-file=.env.local");
  process.exit(1);
}

const sql = fs.readFileSync(filePath, "utf8");

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`→ Running ${path.basename(filePath)}…`);
  const start = Date.now();
  await client.query(sql);
  console.log(`✓ Done in ${Date.now() - start}ms`);
} catch (err) {
  console.error("✗ Failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
