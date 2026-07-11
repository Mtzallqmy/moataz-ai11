# Moataz AI External Sandbox

This is a separate execution boundary for production shell commands. The main Railway application never runs user commands inside its own container.

## Railway deployment

Create a second Railway service from the same repository and set:

- **Root Directory:** `sandbox-service`
- **Dockerfile Path:** `sandbox-service/Dockerfile` when Railway does not resolve it automatically
- **Replicas:** `1`
- **Volume mount:** `/workspace` when persistent workspaces are required

Required variable:

```env
SANDBOX_TOKEN=<independent random value of at least 32 characters>
```

Optional limits:

```env
SANDBOX_DEFAULT_TIMEOUT_MS=120000
SANDBOX_MAX_TIMEOUT_MS=300000
SANDBOX_MAX_OUTPUT_BYTES=1048576
SANDBOX_MAX_BODY_BYTES=65536
SANDBOX_WORKSPACE_DIR=/workspace
```

After deployment, add an **External Sandbox** integration in Moataz AI:

- Base URL: the public HTTPS URL of this second service
- Token: exactly the `SANDBOX_TOKEN` value

Then save and test the integration. The service exposes:

- `GET /health`
- `POST /v1/execute`

`POST /v1/execute` requires `Authorization: Bearer <SANDBOX_TOKEN>` and accepts:

```json
{
  "command": "pwd && ls -la",
  "timeoutMs": 120000,
  "userId": "application-user-id"
}
```

## Security boundary

The container runs as the unprivileged `node` user, receives only a minimal environment, isolates each application user under `/workspace/<userId>`, limits request/output size and command duration, and kills timed-out process groups. For stronger isolation, deploy this service with Railway resource limits, no unrelated secrets, one dedicated volume, and restricted outbound networking where your platform supports it.
