-- AURA Production PostgreSQL Schema (Supabase)
-- Run in Supabase SQL Editor. All tables enable RLS with no public policies so access
-- happens strictly via authenticated Next.js API routes using SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS aura_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  photo_data_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aura_users_email ON aura_users (LOWER(email));

CREATE TABLE IF NOT EXISTS aura_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aura_users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_aura_sessions_user_id ON aura_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_aura_sessions_expires_at ON aura_sessions (expires_at);

CREATE TABLE IF NOT EXISTS aura_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aura_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aura_users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  upload_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extraction_status TEXT NOT NULL,
  extracted_data JSONB,
  extraction_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_aura_documents_user_upload
  ON aura_documents (user_id, upload_timestamp DESC);

CREATE TABLE IF NOT EXISTS aura_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aura_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  linked_document_id TEXT,
  linked_document_name TEXT,
  source TEXT NOT NULL,
  recurrence TEXT DEFAULT 'none',
  snooze_count INT DEFAULT 0,
  reminder JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aura_tasks_user_due ON aura_tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_aura_tasks_user_doc ON aura_tasks (user_id, linked_document_id);

CREATE TABLE IF NOT EXISTS aura_products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aura_users(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  brand TEXT,
  model_number TEXT,
  serial_number TEXT,
  purchase_date TEXT,
  warranty_expiry TEXT,
  warranty_duration TEXT,
  warranty_status TEXT NOT NULL DEFAULT 'unknown',
  linked_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_roles JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aura_products_user_id ON aura_products (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS aura_contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aura_users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  linked_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aura_contacts_user_id ON aura_contacts (user_id, company_name);

CREATE TABLE IF NOT EXISTS aura_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES aura_users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  approved_by_user BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aura_memories_user_id ON aura_memories (user_id, updated_at DESC);

-- Enable Row Level Security across all tables (service_role server client bypasses RLS;
-- anon/public PostgREST clients are blocked by default when no permissive policies exist).
ALTER TABLE aura_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE aura_memories ENABLE ROW LEVEL SECURITY;
