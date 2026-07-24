import pg from "pg";
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(process.argv[2]);
console.log(JSON.stringify(rows, null, 2));
await client.end();
