# External sandbox contract

Moataz AI never executes production shell commands inside the Railway application container. The `sandbox` integration delegates each explicitly confirmed command to a separately deployed, isolated service.

## Required endpoints

### `GET /health`

Headers:

```http
Authorization: Bearer <integration token>
Accept: application/json
```

Return any `2xx` response. A recommended body is:

```json
{
  "ok": true,
  "service": "sandbox",
  "version": "1"
}
```

### `POST /v1/execute`

Headers:

```http
Authorization: Bearer <integration token>
Content-Type: application/json
```

Request:

```json
{
  "command": "npm test",
  "timeoutMs": 120000,
  "userId": "application-user-id"
}
```

Recommended success response:

```json
{
  "stdout": "...",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 1532,
  "timedOut": false
}
```

Return a non-`2xx` status for rejected or failed executions. Moataz AI limits the response size and forwards a structured failure without exposing the sandbox token.

## Mandatory isolation requirements

The external service must create a fresh or reset execution environment for each request. It must not mount the Railway application filesystem, Docker socket, host credentials, cloud metadata endpoints, or unrestricted secrets. Apply CPU, memory, process, disk, execution-time, and output limits. Restrict outbound networking by policy and authenticate every request with a rotated secret.

The `userId` is an audit/workspace selector, not proof of identity. Authorization comes from the bearer token and the service's own policy.

## Railway configuration

No sandbox token is stored in Railway variables by Moataz AI. Add the integration from the application UI:

- Type: `External Sandbox`
- Base URL: the public HTTPS origin of the sandbox service
- Token: the service bearer token

Then press **Test connection**. The terminal page becomes available only after the integration is `verified`.
