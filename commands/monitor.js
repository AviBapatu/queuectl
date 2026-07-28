function registerMonitorCommands(program, db) {
  // --- 1. STATUS COMMAND (COMPREHENSIVE PRODUCTION DASHBOARD) ---
  program
    .command('status')
    .description('Human-readable summary of job counts by state, active workers, and config')
    .action(() => {
      console.log('=== QueueCTL Production Dashboard ===\n');

      // 1. Job counts by state
      const states = ['pending', 'processing', 'completed', 'failed', 'dead'];
      const summary = states.map((state) => {
        const row = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE state = ?').get(state);
        return { State: state, Count: row ? row.count : 0 };
      });
      console.log('--- Job Counts by State ---');
      console.table(summary);

      // 2. Active Worker PIDs from database
      const workers = db.prepare('SELECT pid, status, started_at FROM workers').all();
      console.log('\n--- Active Workers (PID Registry) ---');
      if (workers.length > 0) {
        const formattedWorkers = workers.map((w) => ({
          PID: w.pid,
          Status: w.status,
          StartedAt: new Date(w.started_at * 1000).toISOString(),
        }));
        console.table(formattedWorkers);
      } else {
        console.log('No active workers found in database.');
      }

      // 3. Current Configuration
      const configs = db.prepare('SELECT key, value FROM config').all();
      console.log('\n--- Current Configuration ---');
      if (configs.length > 0) {
        const configTable = configs.map((c) => ({ Key: c.key, Value: c.value }));
        console.table(configTable);
      } else {
        console.log('No configurations found.');
      }
    });

  // --- 2. METRICS COMMAND ---
  program
    .command('metrics')
    .description('View historical metrics and system health')
    .action(() => {
      const now = Math.floor(Date.now() / 1000);
      const last24Hours = now - 24 * 60 * 60;

      // 1. Throughput: Completed in the last 24 hours
      const completed24h = db
        .prepare(
          `
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE state = 'completed' AND updated_at >= ?
      `
        )
        .get(last24Hours);

      // 2. Queue Latency: Average wait time of currently pending jobs
      const waitTime = db
        .prepare(
          `
        SELECT AVG(? - created_at) as avgWait 
        FROM jobs 
        WHERE state = 'pending'
      `
        )
        .get(now);

      // 3. System Strain: Total retries ever executed across all jobs
      const totalRetries = db
        .prepare(
          `
        SELECT SUM(attempts) as sum 
        FROM jobs
      `
        )
        .get();

      // 4. DLQ Ratio: Total jobs currently dead
      const dlqCount = db
        .prepare(
          `
        SELECT COUNT(*) as count 
        FROM jobs 
        WHERE state = 'dead'
      `
        )
        .get();

      console.log(`\n=== QueueCTL Health & Metrics ===\n`);
      console.log(`  Throughput (Last 24h):  ${completed24h.count} jobs completed`);
      console.log(
        `  Avg Pending Latency:    ${
          waitTime && waitTime.avgWait != null
            ? Math.round(waitTime.avgWait) + ' seconds'
            : '0 seconds (Queue Empty)'
        }`
      );
      console.log(`  Total Retries Fired:    ${totalRetries.sum || 0} attempts`);
      console.log(`  Dead Letter Queue:      ${dlqCount.count} jobs permanently failed\n`);
      console.log(`=================================\n`);
    });
}

module.exports = { registerMonitorCommands };
