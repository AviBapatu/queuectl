const { v4: uuidv4 } = require('uuid');

function registerJobCommands(program, db) {
  // --- 1. ENQUEUE COMMAND ---
  program
    .command('enqueue <jsonString>')
    .description('Add a new job')
    .action((jsonString) => {
      try {
        const payload = JSON.parse(jsonString);

        if (!payload.command) {
          console.error("Error: Job must contain a 'command' field.");
          process.exit(1);
        }

        const id = payload.id || uuidv4();
        const maxRetries = payload.max_retries !== undefined ? payload.max_retries : 3;
        const priority = payload.priority || 0;
        const now = Math.floor(Date.now() / 1000);
        const runAt = payload.run_at !== undefined ? payload.run_at : now;

        db.prepare(`
          INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
          VALUES (?, ?, 'pending', 0, ?, ?, ?, ?, ?)
        `).run(id, payload.command, maxRetries, priority, runAt, now, now);

        console.log(`Successfully enqueued job ${id}`);
      } catch (err) {
        console.error('Failed to enqueue job. Ensure input is valid JSON.', err.message);
        process.exit(1);
      }
    });

  // --- 2. LIST COMMAND (THE STRICT JSON CONTRACT) ---
  program
    .command('list')
    .description('List jobs by state')
    .option('--state <state>', 'Filter by job state (pending, processing, completed, failed, dead)')
    .option('--json', 'Output strictly as a JSON array')
    .action((options) => {
      let query = 'SELECT * FROM jobs';
      let params = [];

      if (options.state) {
        query += ' WHERE state = ?';
        params.push(options.state);
      }

      const jobs = db.prepare(query).all(...params);

      if (options.json) {
        // STRICT INTERFACE CONTRACT: Print ONLY JSON array. No extra text.
        console.log(JSON.stringify(jobs));
      } else {
        console.table(jobs);
      }
    });

  // --- 3. LOGS COMMAND ---
  program
    .command('logs <id>')
    .description('View the execution output logs for a specific job')
    .action((id) => {
      const job = db.prepare('SELECT output FROM jobs WHERE id = ?').get(id);

      if (!job) {
        console.error(`Error: Job ${id} not found.`);
        process.exit(1);
      }

      if (!job.output) {
        console.log(`No output logs recorded for job ${id}.`);
      } else {
        console.log(`\n=== Output for Job ${id} ===\n`);
        console.log(job.output);
        console.log(`\n=================================\n`);
      }
    });
}

module.exports = { registerJobCommands };
