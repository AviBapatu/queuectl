#!/bin/bash

echo "[DEMO] Setting strict timeout to 2 seconds..."
queuectl config set timeout_ms 2000

echo "[DEMO] Enqueuing a hanging job (sleep 10) which exceeds the 2s limit..."
queuectl enqueue '{"id": "demo-timeout-6", "command": "sleep 10"}'

echo "[DEMO] Start a worker now to watch the timeout guillotine execute!"
