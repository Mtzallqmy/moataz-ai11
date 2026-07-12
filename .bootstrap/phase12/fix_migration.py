from pathlib import Path
p=Path('drizzle/0000_phase12_postgres.sql')
s=p.read_text()
s=s.replace(
"  finished_at = COALESCE(agent_runs.finished_at, agent_runs.completed_at),",
"  finished_at = COALESCE(agent_runs.finished_at, agent_runs.completed_at, CASE WHEN agent_runs.status IN ('completed','failed','cancelled') THEN agent_runs.created_at END),"
)
s=s.replace(
"CREATE INDEX IF NOT EXISTS websocket_tickets_expiry_idx ON websocket_tickets(expires_at);",
"CREATE UNIQUE INDEX IF NOT EXISTS websocket_tickets_hash_unique ON websocket_tickets(token_hash);\nCREATE INDEX IF NOT EXISTS websocket_tickets_expiry_idx ON websocket_tickets(expires_at);"
)
p.write_text(s)
