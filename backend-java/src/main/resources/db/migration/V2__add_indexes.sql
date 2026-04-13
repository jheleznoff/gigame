CREATE INDEX IF NOT EXISTS idx_scenario_run_steps_run ON scenario_run_steps(run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_conversations_kb ON conversations(knowledge_base_id);
ALTER TABLE kb_documents ADD CONSTRAINT uq_kb_doc UNIQUE (knowledge_base_id, document_id);
