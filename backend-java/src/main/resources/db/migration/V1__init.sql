CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Conversations
CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title       VARCHAR(255) NOT NULL DEFAULT 'Новый диалог',
    knowledge_base_id UUID,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Messages
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL,
    content         TEXT NOT NULL,
    document_ids    JSONB,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

-- Documents
CREATE TABLE documents (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename       VARCHAR(500) NOT NULL,
    content_type   VARCHAR(255),
    file_path      VARCHAR(1000),
    extracted_text TEXT,
    size_bytes     INTEGER,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Knowledge bases
CREATE TABLE knowledge_bases (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- KB ↔ Document join
CREATE TABLE kb_documents (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_count       INTEGER DEFAULT 0,
    status            VARCHAR(50) NOT NULL DEFAULT 'processing',
    error_message     TEXT,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_documents_kb_id ON kb_documents(knowledge_base_id);
CREATE INDEX idx_kb_documents_doc_id ON kb_documents(document_id);

-- Embeddings (pgvector)
CREATE TABLE embeddings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_type     VARCHAR(10) NOT NULL,
    collection_id       UUID NOT NULL,
    source_document_id  UUID,
    chunk_index         INTEGER,
    chunk_text          TEXT,
    embedding           vector(1024)
);
CREATE INDEX idx_embeddings_collection ON embeddings(collection_type, collection_id);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Scenarios
CREATE TABLE scenarios (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    graph_data  JSONB,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Scenario runs
CREATE TABLE scenario_runs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scenario_id        UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    status             VARCHAR(50) NOT NULL DEFAULT 'pending',
    input_document_ids JSONB,
    result             TEXT,
    started_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    completed_at       TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_scenario_runs_scenario_id ON scenario_runs(scenario_id);

-- Scenario run steps
CREATE TABLE scenario_run_steps (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id       UUID NOT NULL REFERENCES scenario_runs(id) ON DELETE CASCADE,
    node_id      VARCHAR(255),
    node_type    VARCHAR(100),
    status       VARCHAR(50) NOT NULL DEFAULT 'pending',
    input_data   JSONB,
    output_data  JSONB,
    prompt_used  TEXT,
    tokens_used  INTEGER,
    started_at   TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_scenario_run_steps_run_id ON scenario_run_steps(run_id);

-- FK from conversations to knowledge_bases (added after both tables exist)
ALTER TABLE conversations
    ADD CONSTRAINT fk_conversations_kb
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE SET NULL;
