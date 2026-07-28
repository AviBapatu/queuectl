# QueueCTL (Node.js Edition)

> **Video Demonstration:** [Watch the 3-Minute Loom Walkthrough and Architecture Tour Here](#)

QueueCTL is a robust, production-grade, CLI-driven background job processing system built in Node.js and backed by SQLite in Write-Ahead Logging (`WAL`) mode. It features atomic job claiming across multiple parallel worker processes, exponential backoff with a Dead Letter Queue (DLQ), strict job timeouts, output log persistence, automated crash recovery under 60 seconds, and a real-time web dashboard.

---

## Quick-Start (TL;DR)

Test QueueCTL instantly in your terminal in 3 simple steps:
```bash
npm install && npm link
queuectl enqueue '{"command": "echo Hello World"}'
queuectl worker start
```

---

## Features & Architectural Highlights

- **Atomic Job Claiming:** Uses SQLite 3.35+ `UPDATE ... RETURNING *` queries within WAL mode to mathematically eliminate race conditions across multiple OS processes.
- **Crash Recovery (The Sweeper):** A background loop checks for jobs with stale heartbeats (`heartbeat_at < now - 30`), automatically recovering abandoned jobs from `SIGKILL` (`kill -9`) within a worst-case window of 45 seconds.
- **Modular CLI Architecture:** Clean separation of concerns with domain-specific registrars (`commands/jobs.js`, `commands/workers.js`, `commands/monitor.js`, `commands/config.js`, `commands/dlq.js`, `commands/dashboard.js`), featuring standard Unix `man` help text and a clean, zero-emoji professional output format.
- **Robust IPC & Ghost PID Fix:** Manages active workers via a database registry and sends OS `SIGTERM` signals, gracefully handling stale processes via `ESRCH` catch blocks.
- **Advanced Hardening & Observability:**
  - **Strict Job Timeouts:** Dynamic configuration (`timeout_ms`) injected into Node's `child_process.exec`.
  - **OOM Protection:** Automatic log truncation (`max 10,000 chars`) preventing database bloat.
  - **Real-Time Web Dashboard:** A zero-dependency, light-themed Tailwind CSS mission control center running on Express with 2-second auto-refresh and persistent historical tracking (`queuectl dashboard`).
  - **Historical Metrics & Logs:** Native SQL aggregate analytics (`queuectl metrics`) and captured stdout/stderr inspection (`queuectl logs <id>`).

---

## System Architecture & Workflow Diagrams

For detailed visual architecture diagrams (High-Level Component Flow, Job State Machine, and Crash Recovery Sweeper Sequence), see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Prerequisites

- **Node.js** >= 18.x (required for `better-sqlite3` native binding)
- **SQLite** >= 3.35.0 (required for `UPDATE ... RETURNING` syntax; bundled via `better-sqlite3`)
- **npm** >= 9.x

---

## Setup Instructions

1. **Clone and Install Dependencies:**
   ```bash
   git clone https://github.com/AviBapatu/queuectl.git
   cd queuectl
   npm install
   ```

2. **Link the CLI Globally:**
   ```bash
   npm link
   ```
   This maps the `queuectl` binary globally as configured in `package.json`.

---

## Usage Guide & Command Reference

### Command Matrix Reference

| Command | Description | Key Flags / Options | Output Format |
| :--- | :--- | :--- | :--- |
| `queuectl enqueue '<JSON>'` | Enqueues a new job into the queue. | `command` (required), `priority`, `max_retries`, `run_at`, `id` | Success confirmation message |
| `queuectl list` | Lists jobs filtered by state. | `--state <state>`, `--json` | Strict JSON array (`--json`) or Table |
| `queuectl worker start` | Starts background worker processing. | `--count <N>` (spawns `N` child processes) | Foreground execution logs |
| `queuectl worker stop` | Gracefully shuts down active workers. | None (sends `SIGTERM` via PID registry) | Shutdown notification summary |
| `queuectl status` | Displays comprehensive system health summary. | None | Tabular dashboard (counts, PIDs, config) |
| `queuectl metrics` | Computes historical operational throughput. | None | Formatted health analytics text |
| `queuectl dashboard` | Launches the real-time web UI. | `-p, --port <number>` (default: `3000`) | HTTP server startup logs |
| `queuectl logs <id>` | Inspects captured stdout/stderr output logs. | None | Formatted text block of execution logs |
| `queuectl config <action> <key> [value]` | Manages persistent system settings. | `set <key> <value>`, `get <key>` | Configuration confirmation |
| `queuectl dlq` | Manages Dead Letter Queue quarantine. | `list [--json]`, `retry <id>` | JSON array or status message |
| `queuectl clear` | Wipes jobs and worker state (Danger). | `-f, --force` | Clearance confirmation message |

---

### Command Usage Examples

- **Enqueue a Job:**
  ```bash
  queuectl enqueue '{"command": "echo Hello", "priority": 10, "max_retries": 3}'
  ```

- **Enqueue a Scheduled Job (Runs in the Future):**
  ```bash
  queuectl enqueue '{"command": "echo Scheduled", "run_at": 1722200000}'
  ```
  The `run_at` field accepts a Unix epoch timestamp. Workers will not claim this job until the system clock passes that timestamp.

- **Start Worker Fleet:**
  ```bash
  queuectl worker start --count 2
  # (Also supports worker-start / worker start)
  ```

- **Check System Status & Metrics:**
  ```bash
  queuectl status
  queuectl metrics
  ```

- **List Jobs (Strict JSON Contract for Automated Tests):**
  ```bash
  queuectl list --state pending --json
  ```

- **View Job Output Logs:**
  ```bash
  queuectl logs <job-id>
  ```

- **Launch the Real-Time Web Dashboard:**
  ```bash
  queuectl dashboard --port 3000
  # Then open http://localhost:3000 in your browser
  ```

- **Manage Dead Letter Queue (DLQ):**
  ```bash
  queuectl dlq list --json
  queuectl dlq retry <job-id>
  ```

- **Graceful Shutdown:**
  ```bash
  queuectl worker stop
  # (Alias: worker-stop)
  ```

---

## Automated Verification Suite

QueueCTL includes a rigorous 10-test automated verification suite covering core functionality, concurrency constraints, and extreme edge cases (Stampede tests, OOM attacks, time-travel validation, and timeout guillotines):
```bash
node test-verify.js
```

---

## Demo Showcase Scripts

A dedicated `demo/` folder is provided with pre-built shell scripts to test and demonstrate system behaviors instantly:

- `./demo/seed-mix.sh` — Seeds a rich mix of fast, slow, high-priority, scheduled, and doomed jobs.
- `./demo/trigger-timeout.sh` — Demonstrates strict execution timeout limits and backoff.
- `./demo/trigger-oom-log.sh` — Demonstrates massive stdout capture and OOM log truncation.

---

## Troubleshooting & FAQ

- **How do I reset the database to a clean slate during local development or before a demo?**
  Run `queuectl clear --force` to instantly truncate all jobs, workers, and DLQ entries while preserving your schema. Alternatively, you can delete `queuectl.db*` (`rm -f queuectl.db*`); QueueCTL will automatically re-initialize a fresh schema on the next command.
- **Why do jobs seem to "disappear" after finishing?**
  By default, `queuectl list --state pending` only displays pending jobs. To view completed or dead jobs, use the **QueueCTL Mission Control** web dashboard (`queuectl dashboard -p 3000`), which includes a persistent **Recent History (Completed & Dead)** table at the bottom of the page.
- **What happens if a worker process is abruptly killed with `kill -9` (`SIGKILL`)?**
  The background **Sweeper** loop running in surviving workers scans every 15 seconds for any `'processing'` job with `heartbeat_at < now - 30`. It automatically recovers abandoned jobs back to `'pending'` within a worst-case window of 45 seconds.

---

## Project Structure

```
queuectl/
  bin/queuectl.js        # CLI entry point (Commander.js)
  commands/
    jobs.js              # enqueue, list, logs
    workers.js           # worker start, worker stop
    monitor.js           # status, metrics
    config.js            # config set/get
    dlq.js               # dlq list, dlq retry
    admin.js             # clear --force
    dashboard.js         # Express web dashboard
  db.js                  # SQLite WAL mode initialization and schema
  queries.js             # Atomic UPDATE ... RETURNING claim query
  worker.js              # Execution engine, heartbeat, sweeper, backoff
  test-verify.js         # 10-test automated verification suite
  demo/                  # Pre-built showcase scripts
  ARCHITECTURE.md        # Visual Mermaid diagrams
  DECISIONS.md           # Architectural trade-off explanations
```

---

## License

ISC

