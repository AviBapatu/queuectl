# QueueCTL - Architecture Decisions (DECISIONS.md)

This document outlines the core architectural and design decisions implemented in QueueCTL to ensure enterprise-grade concurrency safety, fault tolerance, and operability.

---

### 1. Which exact line(s) prevent two workers from claiming the same job, and why is that operation atomic across separate OS processes?

- **Implementation Location:** `queries.js` using the SQLite 3.35+ `UPDATE ... RETURNING` clause.
- **Mechanism:**
  ```sql
  UPDATE jobs 
  SET state = 'processing', locked_by = ?, heartbeat_at = ?, updated_at = ? 
  WHERE id = (
      SELECT id FROM jobs 
      WHERE state = 'pending' AND run_at <= ? 
      ORDER BY priority DESC, created_at ASC 
      LIMIT 1
  ) 
  RETURNING *;
  ```
- **Why it is atomic:** SQLite natively handles file-level locking during write transactions. By combining SQLite's Write-Ahead Logging (`WAL`) mode (which allows concurrent readers while a write lock is pending) with a single atomic `UPDATE ... RETURNING` statement, the database ensures that no two OS processes can evaluate and claim the same pending row simultaneously. The database serves as the ultimate source of truth, making application-level mutexes unnecessary.

---

### 2. A worker is SIGKILLed halfway through a job. Walk through, step by step, what state the job is in and how it eventually runs again. What is the worst-case delay before recovery?

- **State upon SIGKILL (`kill -9`):** The job remains strictly stuck in the `processing` state. Because `SIGKILL` halts the process instantly at the OS level, no catch blocks or asynchronous cleanup handlers can run.
- **The Heartbeat Mechanism:** While processing a job, the worker executes a `setInterval` loop every 10 seconds to update the `heartbeat_at` timestamp for that specific job. Upon `SIGKILL`, this heartbeat stops immediately.
- **The Sweeper Recovery Loop:** Every 15 seconds, active workers run a background query scanning for any jobs where `state = 'processing'` and `heartbeat_at < (now - 30)`.
- **Resolution:** When a sweeper detects a stale heartbeat, it forcefully resets the job back to `pending`, clears the `locked_by` lock, and increments the attempts count.
- **Worst-Case Recovery Delay:** 45 seconds (30 seconds for the heartbeat to age past the threshold, plus up to 15 seconds for the next sweeper execution interval). This safely satisfies the requirement of recovery under 60 seconds.

---

### 3. Does dlq retry reset attempts? Why is that the right call?

- **Behavior:** Yes, `queuectl dlq retry <id>` resets the job's `attempts` counter strictly back to `0`, updates `state` to `'pending'`, and refreshes timestamps.
- **Justification:** A job landing in the Dead Letter Queue (`dead` state) signifies a permanent, unrecoverable failure after exhausting its configured retry budget. If a human operator manually initiates a retry via the CLI, it presumes that the underlying systemic blocker (e.g., a down downstream service, missing environment variables, or a bad payload) has been fixed. Resetting attempts grants the job a clean slate and a full lifecycle of retries under normal operating conditions.

---

### 4. What designs did you consider and reject for worker stop (cross-process signaling), and why?

- **Rejected - TCP Control Sockets:** Having each worker bind to a local ephemeral TCP port to listen for shutdown commands. Reason for rejection: Managing port allocations across multiple concurrent terminal sessions is fragile, prone to port-in-use collisions, and overly complex for a CLI tool.
- **Rejected - Database Polling Flag:** Having workers poll a central configuration flag or table column to check if shutdown was requested. Reason for rejection: Polling introduces unnecessary latency to the shutdown sequence and burdens the database with constant read queries.
- **Chosen - PID Registry + Native OS Signals:** Workers register their native `process.pid` inside a SQLite `workers` table upon startup. The `worker stop` command reads active PIDs and dispatches a native Unix `SIGTERM` signal via `process.kill(pid, 'SIGTERM')`, complete with an `ESRCH` try/catch hardening step to clean up ghost processes. This approach is stateless, instantaneous, and strictly adheres to standard Unix process management paradigms.

---

### 5. If priorities were added tomorrow (high-priority jobs jump the queue), which parts of your design survive unchanged and which break?

- **Survives Unchanged:** The core execution engine, the output logger, the background sweeper crash recovery, the IPC remote shutdown mechanism, and the CLI layout layers require zero architectural changes.
- **Required Updates:** Only two localized changes were required:
  1. Adding a `priority INTEGER DEFAULT 0` column to the `jobs` table schema.
  2. Modifying the atomic claim query's `ORDER BY` clause from `ORDER BY created_at ASC` to `ORDER BY priority DESC, created_at ASC`.
  *(Note: This priority sorting mechanism was preemptively incorporated into the core implementation).*
