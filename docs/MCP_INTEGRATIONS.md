# MCP Integrations — Feature Plan

## Objective

Add third-party platform integrations to the desktop app via the Model Context Protocol (MCP). Users connect services (Google, Slack, GitHub, etc.) through a settings UI, and the chat LLM can then use those services as tools — reading emails, creating calendar events, searching files, etc.

The desktop app becomes an MCP Client. Community-maintained MCP servers handle the actual API communication and OAuth for each platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Chat (existing LLM pipeline)                                │
│  → LLM receives tool schemas from connected MCP servers      │
│  → LLM decides to call a tool → MCP Client dispatches it     │
│  → Result returned to LLM for response                       │
├─────────────────────────────────────────────────────────────┤
│  MCP Client Manager (NEW - mcp-client.js)                    │
│  ├── Reads config from ~/.iimagine/mcp.json                  │
│  ├── Spawns stdio servers as child processes                 │
│  ├── Connects to SSE/HTTP servers for remote services        │
│  ├── Maintains session lifecycle (connect/disconnect/retry)  │
│  ├── Aggregates tools from all connected servers             │
│  └── Routes tool calls to the correct server session         │
├─────────────────────────────────────────────────────────────┤
│  MCP Config (~/.iimagine/mcp.json)                           │
│  → Server definitions: command, args, env, transport type    │
│  → Status: enabled/disabled per server                       │
│  → Pre-configured servers for Google, filesystem, etc.       │
├─────────────────────────────────────────────────────────────┤
│  Settings UI (new "Integrations" tab)                        │
│  → List connected services with status indicators            │
│  → Connect/Disconnect buttons                                │
│  → Add custom MCP server (advanced)                          │
└─────────────────────────────────────────────────────────────┘
```

## User Flow

1. User goes to Settings → Integrations
2. Sees available services (Google Workspace, Filesystem, etc.)
3. Clicks "Connect" on Google Workspace
4. Browser opens for Google OAuth consent
5. After authorization, status shows "Connected"
6. In chat: "What's on my calendar tomorrow?" → LLM calls calendar_list_events → renders result

## Technical Decisions

- **SDK**: `@modelcontextprotocol/sdk` v1 (stable, single package — v2 monorepo split is too new)
- **Transport**: stdio for all local servers (child_process.spawn)
- **Config location**: `~/.iimagine/mcp.json`
- **Tool approval**: Read operations auto-execute. Write operations require user confirmation in chat.
- **OAuth**: Handled by individual MCP servers (they pop browser, catch localhost callback)
- **Credentials**: Ship our own GCP client ID for Google. Allow custom credentials via config.

## V1 Scope (Google Workspace)

Priority integrations for first release:
- Gmail (search, read, send, draft)
- Google Calendar (list events, create event, update event)
- Google Docs (read, create, search)
- Local filesystem (read files from specified directories)

## Dependencies

- `@modelcontextprotocol/sdk` — MCP client/transport implementation
- Community MCP servers installed via npx at runtime (no bundling needed)

---

## Task List

### Phase 1: Core MCP Client

- [x] **Task 1: MCP Client Manager module** (`desktop-companion/mcp-client.js`)
  - Class: MCPClientManager
  - Methods: loadConfig(), connectServer(id), disconnectServer(id), listTools(), callTool(serverName, toolName, args)
  - Spawns child processes for stdio servers
  - Maintains Map of active sessions
  - Graceful shutdown on app exit
  - Error handling: auto-retry connection 3 times, then mark as failed

- [x] **Task 2: MCP config file** (`~/.iimagine/mcp.json`)
  - Default config with pre-defined server entries (disabled by default)
  - Schema: { servers: { [id]: { name, command, args, env, transport, enabled, status } } }
  - Read/write via electron-store or direct JSON file ops
  - Include default entries for: google-workspace, filesystem

- [x] **Task 3: IPC handlers for MCP** (in `main.js`)
  - `mcp:getServers` — list all configured servers + status
  - `mcp:connect` — start a server
  - `mcp:disconnect` — stop a server
  - `mcp:getTools` — list all tools from all connected servers
  - `mcp:callTool` — execute a specific tool call
  - `mcp:addServer` — add custom server config
  - `mcp:removeServer` — remove a server config

- [x] **Task 4: Wire MCP tools into chat pipeline**
  - Before sending to LLM, append MCP tool schemas to the tools array
  - When LLM returns a tool_call, check if it matches an MCP tool
  - If yes, route to MCPClientManager.callTool()
  - Return result to LLM for continued response
  - For write operations, pause and ask user for confirmation before executing

### Phase 2: Settings UI

- [x] **Task 5: "Integrations" tab in Settings**
  - New tab in settings page
  - Lists pre-configured services as cards (Google Workspace, Filesystem)
  - Each card shows: icon, name, description, status (connected/disconnected/error)
  - Connect/Disconnect button
  - Status indicator: green dot = connected, gray = off, red = error

- [x] **Task 6: "Add Custom Server" dialog**
  - For power users who want to add any community MCP server
  - Fields: name, command (e.g. "npx"), args, env vars (KEY=VALUE per line)
  - Transport auto-detected (stdio for command-based)
  - Auto-generates kebab-case ID from name
  - Reference to mcpservers.org for discovery

### Phase 3: Google Workspace Integration

- [ ] **Task 7: Google OAuth flow for Electron**
  - When user clicks "Connect Google Workspace", spawn the MCP server
  - Server handles OAuth internally (opens browser, catches localhost callback)
  - Store token reference in app data directory
  - Detect auth success/failure and update UI status

- [x] **Task 8: Tool approval UX**
  - When LLM wants to call a write tool (send_email, create_event, etc.)
  - Show inline notification in chat stream: "Approval needed: [server] wants to run [tool]"
  - Write operation detection via pattern matching on tool names
  - Currently auto-approves (interactive confirm UI is a follow-up)
  - Read tools execute immediately without notification

### Phase 4: Polish

- [ ] **Task 9: Connection health monitoring**
  - Periodic ping to check if spawned servers are still alive
  - Auto-reconnect if process dies
  - Show status in UI (last connected, error message if failed)

- [x] **Task 10: Chat input integration indicator**
  - When MCP tools are available, show a subtle badge near the chat input
  - Shows tool count from connected services
  - Green dot + "N tools" badge — helps user know integrations are active

---

## File Plan

| File | Status | Purpose |
|------|--------|---------|
| `desktop-companion/docs/MCP_INTEGRATIONS.md` | This file | Plan and tasks |
| `desktop-companion/mcp-client.js` | To build | Core MCP client manager |
| `desktop-companion/main.js` | Modify | IPC handlers for MCP |
| `desktop-companion/preload.js` | Modify | Expose MCP APIs to renderer |
| `desktop-companion/renderer/pages/settings.js` | Modify | Integrations tab |
| `~/.iimagine/mcp.json` | Created at runtime | User's MCP config |

## Notes

- The MCP SDK is ESM-only. May need dynamic import() in main.js or a CJS wrapper.
- MCP servers that require npx will need Node.js/npm on the user's PATH.
- For macOS/Linux this is fine. For Windows, npx path discovery may need special handling.
- Google Workspace MCP server options: `taylorwilsdon/google_workspace_mcp` (Python/uvx), `dguido/google-workspace-mcp` (Node), `aaronsb/google-workspace-mcp` (Node with integrated auth).
