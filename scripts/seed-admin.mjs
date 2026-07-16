#!/usr/bin/env node
// Create the first admin user of the app + assign the admin role.
// Uses the Supabase admin API (service-role key).
//
// Usage:
//   node --env-file=.env.local scripts/seed-admin.mjs <email> <password> "<full name>"

import process from "node:process";

const [email, password, fullName] = process.argv.slice(2);
if (!email || !password || !fullName) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password> "<full name>"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};

// 1. Create the auth user (email confirmed = true so they can log in immediately).
const createRes = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  }),
});
const createJson = await createRes.json();
if (!createRes.ok) {
  console.error("Create user failed:", createRes.status, createJson);
  process.exit(1);
}
const userId = createJson.id;
console.log(`✓ Created auth user: ${email} (id: ${userId})`);

// 2. Update the profile row with the full_name (trigger inserted a row already).
const profileRes = await fetch(
  `${url}/rest/v1/profiles?id=eq.${userId}`,
  {
    method: "PATCH",
    headers,
    body: JSON.stringify({ full_name: fullName }),
  },
);
if (!profileRes.ok) {
  console.warn("Profile update warning:", await profileRes.text());
} else {
  console.log(`✓ Profile updated`);
}

// 3. Assign the admin role.
const roleRes = await fetch(`${url}/rest/v1/user_roles`, {
  method: "POST",
  headers: { ...headers, Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({ user_id: userId, role: "admin" }),
});
if (!roleRes.ok) {
  console.error("Role assign failed:", await roleRes.text());
  process.exit(1);
}
console.log(`✓ Assigned admin role`);
console.log(`\nSign in at http://localhost:3000/login with:\n  email:    ${email}\n  password: ${password}`);
