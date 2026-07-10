# Terminal WebSocket protocol

The terminal is disabled unless `ALLOW_SHELL=true`, `SHELL_SANDBOX_MODE=local-development`, and `NODE_ENV` is not `production`. It is never treated as a production sandbox.

1. An authenticated active administrator requests `POST /api/auth/ws-ticket`.
2. The server returns a single-use ticket that expires after `WS_TICKET_TTL_SECONDS` (45 seconds by default).
3. The client connects to `/ws/terminal?ticket=<ticket>` from an allowed Origin.
4. The server atomically consumes the ticket and rechecks the user in the database.

Client messages are JSON: `{"type":"input","data":"ls\n"}`.

Server events are JSON with one of these types: `session_started`, `output`, `process_exit`, or `error`.

Application close codes include: `4400` invalid input, `4408` idle/session timeout, and `4429` connection limit. Authentication and Origin failures are rejected during the HTTP upgrade before a WebSocket session is established.
