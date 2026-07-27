const { exec } = require('child_process');
const db = require('./db');
const { claimNextJob } = require('./queries');

let isShuttingDown = false;
let activeJob = null;
const workerPid = process.pid;

// Register worker in the database for IPC (Remote Worker Stop)
function registerWorker() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR IGNORE INTO workers (pid, started_at, status) VALUES (?, ?, ?)').run(
    workerPid,
    now,
    'active'
  );
}

// --- 1. GRACEFUL SHUTDOWN HANDLER ---
function handleShutdown() {
  console.log(`\n[WORKER ${workerPid}] Received shutdown signal. Initiating graceful shutdown...`);
  isShuttingDown = true;

  // Remove from active workers registry
  try {
    db.prepare('DELETE FROM workers WHERE pid = ?').run(workerPid);
  } catch (e) {
    // Ignore db errors during shutdown
  }

  if (!activeJob) {
    console.log(`[WORKER ${workerPid}] No active job. Exiting immediately.`);
    process.exit(0);
  } else {
    console.log(`[WORKER ${workerPid}] Waiting for job ${activeJob.id} to finish before exiting...`);
  }
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// --- 2. THE SWEEPER (CRASH RECOVERY) ---
// Runs every 15 seconds to find jobs abandoned by SIGKILLed workers (<60s recovery)
let sweeperInterval = null;
function startSweeper() {
  if (sweeperInterval) return;
  sweeperInterval = setInterval(() => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const staleThreshold = now - 30; // 30 seconds without a heartbeat

      const result = db
        .prepare(
          `
        UPDATE jobs 
        SET state = 'pending', locked_by = NULL, updated_at = ?
        WHERE state = 'processing' AND heartbeat_at < ?
      `
        )
        .run(now, staleThreshold);

      if (result.changes > 0) {
        console.warn(`[SWEEPER] Recovered ${result.changes} stuck/SIGKILLed job(s)!`);
      }
    } catch (e) {
      console.error('[SWEEPER] Error checking for stale jobs:', e.message);
    }
  }, 15000);
  // Do not block Node process exit if only sweeper timer is running
  if (sweeperInterval.unref) sweeperInterval.unref();
}

// --- 3. THE EXECUTION ENGINE ---
function executeJob(job) {
  return new Promise((resolve) => {
    activeJob = job;
    console.log(`[WORKER ${workerPid}] Executing job ${job.id}: ${job.command}`);

    // Fetch current config for timeout (default to 30000ms if missing)
    const timeoutConfig = db.prepare("SELECT value FROM config WHERE key = 'timeout_ms'").get();
    const timeoutMs = timeoutConfig ? parseInt(timeoutConfig.value, 10) : 30000;

    // Start the heartbeat interval for THIS specific job every 10 seconds
    const heartbeatInterval = setInterval(() => {
      try {
        const now = Math.floor(Date.now() / 1000);
        db.prepare('UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?').run(
          now,
          now,
          job.id
        );
      } catch (e) {
        // Ignore errors if DB is temporarily busy
      }
    }, 10000);

    // INJECT THE TIMEOUT OPTION HERE
    exec(job.command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      clearInterval(heartbeatInterval);
      const now = Math.floor(Date.now() / 1000);

      // Combine stdout and stderr into a single log string and truncate to 10,000 chars to prevent DB bloat
      const rawLog = (stdout + '\n' + stderr).trim();
      const outputLog = rawLog.length > 10000 ? rawLog.slice(-10000) : rawLog;

      if (error) {
        // Check if the error was caused by our timeout specifically
        if (error.killed) {
          console.error(
            `[WORKER ${workerPid}] Job ${job.id} KILLED: Exceeded ${timeoutMs}ms timeout limit.`
          );
        } else {
          console.error(`[WORKER ${workerPid}] Job ${job.id} failed:`, error.message);
        }

        // Fetch current config for backoff base (default to 2 if missing)
        const configRow = db
          .prepare("SELECT value FROM config WHERE key = 'backoff_base'")
          .get();
        const base = configRow ? parseInt(configRow.value, 10) : 2;

        if (job.attempts > job.max_retries) {
          // Exhausted retries -> Dead Letter Queue (DLQ)
          db.prepare(
            "UPDATE jobs SET state = 'dead', locked_by = NULL, updated_at = ?, output = ? WHERE id = ?"
          ).run(now, outputLog, job.id);
          console.log(`[WORKER ${workerPid}] Job ${job.id} moved to DLQ (dead state).`);
        } else {
          // Exponential Backoff -> Pending
          const delay = Math.pow(base, job.attempts); // delay = base ^ attempts
          const runAt = now + delay;

          db.prepare(
            `
            UPDATE jobs 
            SET state = 'pending', run_at = ?, locked_by = NULL, updated_at = ?, output = ? 
            WHERE id = ?
          `
          ).run(runAt, now, outputLog, job.id);

          console.log(
            `[WORKER ${workerPid}] Job ${job.id} backing off for ${delay}s (attempt ${job.attempts}/${job.max_retries}).`
          );
        }
      } else {
        // SUCCESS SCENARIO
        db.prepare(
          "UPDATE jobs SET state = 'completed', locked_by = NULL, updated_at = ?, output = ? WHERE id = ?"
        ).run(now, outputLog, job.id);
        console.log(`[WORKER ${workerPid}] Job ${job.id} completed successfully.`);
      }

      activeJob = null;
      resolve();
    });
  });
}

// --- 4. THE POLLING LOOP ---
async function startPolling() {
  registerWorker();
  startSweeper();
  console.log(`[WORKER ${workerPid}] Started polling for jobs. Press Ctrl+C to shut down.`);

  while (!isShuttingDown) {
    try {
      const job = claimNextJob(workerPid);

      if (job) {
        await executeJob(job);
        if (isShuttingDown) {
          break;
        }
      } else {
        // No jobs found, sleep for 1 second before polling again to prevent CPU thrashing
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`[WORKER ${workerPid}] Error in polling loop:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`[WORKER ${workerPid}] Exiting cleanly.`);
  process.exit(0);
}

// If invoked directly as a standalone worker script, start polling automatically
if (require.main === module) {
  startPolling();
}

module.exports = {
  startPolling,
  registerWorker,
  startSweeper,
  executeJob,
};
