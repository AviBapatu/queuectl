# QueueCTL - Visual Architecture & System Workflow (ARCHITECTURE.md)

This document provides high-level visual diagrams illustrating the modular CLI component flow, job lifecycle state machine, and automated crash recovery sweeper sequence for **QueueCTL**.

---

## 1. High-Level System Architecture & Component Flow

This diagram illustrates how user commands interact with the modular CLI structure, how SQLite WAL mode handles cross-process persistence, and how background workers interact with OS-level execution and signaling.

```mermaid
graph TD
    User([User / Automated Script]) --> CLI["CLI Entry Point: bin/queuectl.js"]

    subgraph CLICommands [CLI Commands and Modules]
        CLI --> Jobs["commands/jobs.js <br> enqueue, list --json, logs"]
        CLI --> Monitor["commands/monitor.js <br> status, metrics"]
        CLI --> Workers["commands/workers.js <br> worker start/stop"]
        CLI --> Config["commands/config.js <br> config set/get"]
        CLI --> DLQ["commands/dlq.js <br> dlq list, dlq retry"]
        CLI --> Dashboard["commands/dashboard.js <br> Express Web UI"]
    end

    subgraph Persistence [Persistence Layer - SQLite WAL Mode]
        Jobs --> DB[(SQLite Database: queuectl.db)]
        Workers --> DB
        Config --> DB
        DLQ --> DB
        Dashboard --> DB
    end

    subgraph WorkersFleet [Worker Fleet - Child Processes]
        Workers -->|child_process.fork| W1[Worker Process PID 1]
        Workers -->|child_process.fork| W2[Worker Process PID N]
        
        W1 -->|Atomic UPDATE ... RETURNING| DB
        W2 -->|Atomic UPDATE ... RETURNING| DB
        
        W1 -->|child_process.exec| OS1[Shell Command Execution]
        W2 -->|child_process.exec| OS2[Shell Command Execution]
    end

    classDef db fill:#f9f,stroke:#333,stroke-width:2px;
    classDef process fill:#bbf,stroke:#333,stroke-width:1px;
    class DB db;
    class W1,W2 process;
```

---

## 2. Job State Machine Workflow

This diagram outlines the exact transitions a job undergoes throughout its lifecycle, from initial validation and persistence to processing, backoff retries, completion, or DLQ quarantine.

```mermaid
stateDiagram-v2
    [*] --> Pending : queuectl enqueue (attempts = 0, run_at = now)
    
    Pending --> Processing : Worker atomic claim (UPDATE ... RETURNING)
    
    Processing --> Completed : Shell Exit Code 0 (Success)
    Processing --> Failed : Shell Exit Code Non-Zero / Timeout (Failure)
    
    Failed --> Pending : attempts < max_retries (Exponential Backoff: run_at = now + base^attempts)
    Failed --> Dead : attempts >= max_retries (Moved to Dead Letter Queue)
    
    Dead --> Pending : queuectl dlq retry (Resets attempts = 0)
    
    Completed --> [*]
    Dead --> [*]

    state Processing {
        [*] --> HeartbeatActive
        HeartbeatActive --> HeartbeatActive : setInterval updates heartbeat_at every 10s
    }
```

---

## 3. Crash Recovery & Sweeper Lifecycle (The "Murder Test" Defense)

This diagram details the sequence of events when a worker process experiences an abrupt termination (`SIGKILL` / `kill -9`) and how the background Sweeper safely restores system integrity within the 60-second window.

```mermaid
sequenceDiagram
    autonumber
    participant W as Active Worker Process
    participant DB as SQLite DB (queuectl.db)
    participant S as Surviving Worker's Sweeper Loop

    Note over W,DB: Worker claims job and updates heartbeat every 10s
    W->>DB: UPDATE jobs SET state=processing, heartbeat_at=now
    
    Note over W: OS sends SIGKILL kill -9 and halts process instantly without cleanup
    
    rect #FFE6E6
        Note over W,DB: Failure Mode - Job is stuck in processing and heartbeat_at timestamp becomes stale over 30s old
    end

    loop Every 15 Seconds
        S->>DB: Query jobs WHERE state=processing and heartbeat_at is older than 30s
        DB-->>S: Returns abandoned job record
        S->>DB: UPDATE jobs SET state=pending, locked_by=NULL
    end

    Note over S,DB: Job is successfully restored to pending with recovery guaranteed under 60s
```
