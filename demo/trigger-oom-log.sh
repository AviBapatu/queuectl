#!/bin/bash

echo "[DEMO] Enqueuing a job that generates massive stdout logs..."
queuectl enqueue '{"id": "demo-log-7", "command": "node -e \"console.log('\''Massive log line... '\''.repeat(1000))\""}'

echo "[DEMO] Once completed, run: queuectl logs demo-log-7"
