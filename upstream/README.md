# Sidebar DeepSeek Harness

`sidebar_deepseek_harness` is a ToolPkg wrapper around the upstream DeepSeek Harness Web Runtime. It does not translate Cordis plugins into ToolPkg APIs. The Linux terminal runs the original Node runtime, while the ToolPkg sidebar displays its local Web UI. Maintained TypeScript sources live under `src`; run `node scripts/build.js` to parse-check them with the installed TypeScript compiler and reproduce the committed `dist` JavaScript byte for byte.

## Runtime Contract

- Requires `node` and `pnpm` in the Linux terminal environment
- Installs the latest upstream CLI `@deepseek-ai/dsh@latest` under `/root/sidebar_deepseek_harness/node_modules`
- Stores Harness profiles and sessions under `/root/sidebar_deepseek_harness/dsh-home`
- Listens only at `http://127.0.0.1:3081`
- Writes server output to `/root/sidebar_deepseek_harness/deepseek-harness-web.log`

The sidebar first restores an existing page or healthy local Web service without requesting the upstream version. If the page is not available but the runtime is already installed, it starts or reuses that local runtime directly. A full upstream `latest` comparison is triggered by the persistent manual `检查更新` button, while the error-state recheck remains available for recovery. The host toolbar also provides a `重置` action that stops DSH and removes `/root/sidebar_deepseek_harness` plus `/root/dsh_workspace`; it detaches the active WebView before deletion, ignores stale page-load errors from that detached view, and does not remove the separate `~/.dsh` user data directory. After reset completes, the dashboard enters the explicit uninitialized state instead of exposing a transient WebView failure. The Sub-Agent monitor remains available while the Web page is loading; runtime update and reset actions retain their readiness guards. A missing runtime requires an explicit initialization action, and an available update requires an explicit update action. When a DSH process is still starting, the sidebar waits up to two minutes for that process rather than installing or restarting it again. Before an explicit dependency installation, the mobile Linux runtime installs `build-essential` when the compiler is absent, so the DSH `node-pty` lifecycle script can compile. It then writes an `allowBuilds` policy for the five DSH dependencies that require lifecycle scripts and runs `pnpm install --prod` so a partially installed runtime also applies that policy. It locates pnpm's bundled `node-gyp.js` to build DSH's `node-pty` dependency for the installed Node ABI and stores a dereferenced `pty.node` because the mobile Linux container otherwise leaves a dangling symlink into the removed `obj.target` directory.

## Service Access

Version `0.5` includes the enabled `DeepSeek Harness` and `DeepSeek Harness Control` subpackages plus the enabled-by-default `DSH Sub-Agent` subpackage. The service package exposes status plus explicit start, restart, and stop actions for the local Web service. The sidebar keeps the WebView visible as soon as its container is available instead of covering partially rendered page resources with a full-screen loading layer, provides persistent update/reset controls, and automatically retries any idle state that has neither a Web page nor an actionable error. A compact dashboard button immediately before Reset opens the built-in Sub-Agent monitor over the retained WebView, with explicit refresh and back actions. The server is started in a separate session so leaving the sidebar does not terminate DSH or its PTY work.

DSH credentials and profile configuration remain in the upstream Web UI. The ToolPkg does not expose raw credential or environment files to AI tools.

Runtime installation must emit an explicit completion marker before the ToolPkg starts DSH Web. A missing Node or pnpm executable, a pnpm build-policy failure, a DSH installation failure, or a `node-pty` build/load failure is shown directly in the sidebar with the reported cause and recent pnpm output; the ToolPkg does not wait for `127.0.0.1:3081` after an unsuccessful installation.

## DeepSeek Harness Control

The `DeepSeek Harness Control` subpackage provides a set of AI-callable tools for operating and controlling the DeepSeek Harness service via native DSH Web RPCs. It is enabled by default and currently exposes seven tools.

**Session Management**:
- `send_deepseek_harness_message`: Sends a text message to DSH and waits for the final assistant reply, supporting session reuse (`session_id`) and timeout control (`timeout_ms`)
- `get_all_non_empty_conversations`: Lists all sessions containing historical messages, facilitating session management and context tracing

**Workspace Management**:
- `get_current_workspace_path`: Retrieves the currently configured workspace directory
- `set_current_workspace_path`: Switches the DSH workspace directory via RPC calls, enabling AI to automatically change the code or file location based on task requirements

**Theme Management**:
- `set_current_theme`: Persistently switches the interface theme between `light`, `dark`, or `system`
- `get_current_persisted_theme`: Retrieves the currently saved theme configuration

**Service Control**:
- The service package (`DeepSeek Harness`) exposes status query, start, restart, and stop actions, working in conjunction with the Control subpackage

All tools are implemented via native DSH Web RPCs (`/api/session.list`, `/api/session.create`, `/api/session.history`, `/api/session.prompt`, `/api/settings.describe`, `/api/settings.mutate`, etc.) and do not expose raw credentials or environment files to AI tools.

## DSH Sub-Agent

The `DSH Sub-Agent` subpackage in version `0.5` is enabled by default and exposes seven tools: run, status, blocking watch, panel-state generation, terminal-task cleanup, task listing, and cancellation. Cleanup removes terminal task records, logs, job artifacts, and their finished DSH sessions while preserving running tasks. The sidebar monitor reads the same private panel snapshot directly, so viewing task state no longer requires copying `dsh-state.json` to a workspace or opening the preview through a file manager. The monitor parses DSH session statistics for steps, turns, tool calls, and token usage; unresolved statistics are shown as unavailable instead of zero. Task ages use relative labels such as `2h 31m ago`, and the panel refresh timestamp is rendered in the `Asia/Shanghai` time zone. The monitor also provides a cleanup button for terminal tasks and supports scrolling when the task list exceeds the available page height.

Sub-agent sessions are fixed to DSH's `workspace-write` mode. Writes are restricted to the selected workspace and platform temporary roots, while reads, network access, and process visibility are not confined by that DSH mode. The default workspace is `/root/dsh_workspace`; `/` and `/root` are rejected as task workspaces. Execution defaults to synchronous waiting, asynchronous execution requires an explicit `mode=async`, and every task has a hard runtime limit between 10 seconds and one hour.

Inputs, logs, process IDs, exit codes, and state are stored under `/root/sidebar_deepseek_harness/subagent-jobs` with owner-only directory permissions. The one-shot input file is deleted as soon as the runner reads it. No task data is written to Android shared Download storage; panel state is copied to a workspace only when the caller explicitly supplies that workspace. The watcher script is deployed but never started automatically.

## Android Runtime Setup

Upstream `node-pty@1.1.0` has no Linux ARM64 prebuild for Operit's Node 24 runtime. The ToolPkg resolves this by installing the Ubuntu `build-essential` package, compiling `pty.node` inside the DSH runtime, and converting the Android-container symlink output into a regular native file before DSH loads it. The compiler packages use about 113 MB of Linux container storage. This preserves DSH's subprocess, shell, and PTY capabilities.

## Scope

This package provides the original DSH Web Runtime, the ToolPkg conversation and theme bridge, and an optional bounded sub-agent bridge. DSH NPM bundles continue to be installed and managed by DSH itself. Native ToolPkg import, Android/Java bridge access, and offline tarball management remain outside this package.

## Attribution

## Attribution

- `AAswordsman`、`luojiaping`、`空悲切`、`zjxdzh`、`芸`: unified package co-authors.
- `芸`: contributed the sub-agent execution, session analysis, task monitoring, cleanup, and preview implementation included in version `0.4.9`.
- `空悲切`: contributed the version `0.5.0` updates, including the "Checking" hang fix, reconnect button, reset feature, Sub-Agent monitoring panel, toolbar layout optimization, button state fix, and DeepSeek Harness Control subpackage enhancements (theme tools, workspace tools, and conversation tools).