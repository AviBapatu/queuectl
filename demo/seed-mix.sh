#!/bin/bash

echo "[DEMO] Clearing previous state..."
queuectl clear --force
queuectl config set timeout_ms 30000

echo "[DEMO] 1. Enqueuing a normal successful job..."
queuectl enqueue '{"id": "demo-success-1", "command": "echo \"Hello from successful job!\""}'

echo "[DEMO] 2. Enqueuing a slow job (to show in Processing table)..."
queuectl enqueue '{"id": "demo-slow-2", "command": "sleep 15"}'

echo "[DEMO] 3. Enqueuing a HIGH PRIORITY job (Priority 10)..."
queuectl enqueue '{"id": "demo-priority-3", "command": "echo \"I jumped the queue!\"", "priority": 10}'

echo "[DEMO] 4. Enqueuing a doomed job (will fail and go to DLQ)..."
queuectl enqueue '{"id": "demo-doomed-4", "command": "exit 1", "max_retries": 1}'

echo "[DEMO] 5. Enqueuing a scheduled future job (5 mins out)..."
FUTURE_TS=$(($(date +%s) + 300))
queuectl enqueue '{"id": "demo-future-5", "command": "echo \"Future job\"", "run_at": '$FUTURE_TS'}'

echo "[DEMO] Seeding complete! Check your dashboard at http://localhost:3000"
