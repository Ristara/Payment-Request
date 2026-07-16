#!/usr/bin/env node
// Reset a user's password using the Supabase admin API.
//
// Usage:
//   node --env-file=.env.local scripts/reset-password.mjs <email> <new-password>

import process from "node:process";

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-password.mjs <email> <new-password>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY env vars.");
  process.exit(1);
}

const headers = {
  "apikey": secret,
  "Authorization": `Bearer ${secret}`,
  "Content-Type": "application/json",
};

// 1. Find user by email
const listRes = await fetch(
  `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
  { headers },
);
if (!listRes.ok) {
  console.error("List users failed:", listRes.status, await listRes.text());
  process.exit(1);
}
const listJson = await listRes.json();
const user = (listJson.users ?? []).find(
  (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
);
if (!user) {
  console.error("No user found with email:", email);
  process.exit(1);
}

console.log(`Found user ${user.email} (id: ${user.id})`);

// 2. Update password
const updateRes = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ password: newPassword }),
});
if (!updateRes.ok) {
  console.error("Update failed:", updateRes.status, await updateRes.text());
  process.exit(1);
}

console.log(`Password reset for ${user.email}.`);
