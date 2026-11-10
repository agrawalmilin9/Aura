# AURA – Vercel Deployment & Cloud Setup Guide

## 1. Supabase PostgreSQL Setup
1. Create a new project in [Supabase](https://supabase.com/).
2. Open **SQL Editor** and run the full contents of [`supabase/schema.sql`](./supabase/schema.sql).
   - Creates `aura_users`, `aura_sessions`, `aura_rate_limits`, `aura_documents`, `aura_tasks`, `aura_products`, `aura_contacts`, and `aura_memories`.
   - Enables Row Level Security (`ENABLE ROW LEVEL SECURITY`) on every table with zero public/anon policies.
3. Copy **Project URL** (`SUPABASE_URL`) and **service_role secret key** (`SUPABASE_SERVICE_ROLE_KEY`) from **Project Settings → API**.

## 2. Private Vercel Blob Setup
1. In your Vercel project dashboard, go to **Storage → Create Database → Blob**.
2. Choose **Private** access (uploaded personal PDFs and images are never publicly readable).
3. Connect the store to your Vercel project so `BLOB_READ_WRITE_TOKEN` is provisioned automatically.
   - Files `<= 3.8 MB` upload via multipart API; files between `3.8 MB` and `10 MB` upload directly to `uploads/tmp/<userId>/...` using `/api/documents/blob-token` and are validated before moving to `users/<userId>/documents/...`.

## 3. Required Vercel Environment Variables
Add these in **Vercel Project Settings → Environment Variables** (Production & Preview):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side secret only)
- `BLOB_READ_WRITE_TOKEN` (server-side secret only)
- `AUTH_SESSION_SECRET` (random 32+ char string, e.g. `openssl rand -hex 32`)
- `GEMINI_API_KEY`
- `GNANI_API_KEY` (and optional `GNANI_BASE_URL=https://api.vachana.ai`)

## 4. Pre-Deploy Verification Checklist
- [ ] `npx tsc --noEmit` passes with exit code `0`.
- [ ] `npm run build` succeeds with zero route/bundle errors.
- [ ] `.env.local`, `.vercel`, and `data/` are excluded via `.gitignore`.
- [ ] `supabase/schema.sql` executed on target Supabase PostgreSQL instance.
- [ ] All 6 required environment variables set in Vercel Project Settings.
- [ ] Vercel Blob store uses **Private** access.
- [ ] After first deploy, verify `/signup`, `/login`, Guided Upload (small PDF + >4 MB PDF + Camera), `Personal Details Form.pdf` Form Guide, `/api/documents/[id]/file` auth check (401 when logged out), Voice STT/TTS, Tasks, Products, Contacts, and Personal Memory.
