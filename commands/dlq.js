function registerDlqCommands(program, db) {
  // --- DLQ COMMANDS ---
  const dlq = program.command('dlq').description('Manage the Dead Letter Queue');

  dlq
    .command('list')
    .description('View DLQ jobs')
    .option('--json', 'Output strictly as a JSON array')
    .action((options) => {
      const jobs = db.prepare("SELECT * FROM jobs WHERE state = 'dead'").all();
      if (options.json) {
        console.log(JSON.stringify(jobs));
      } else {
        console.table(jobs);
      }
    });

  dlq
    .command('retry <id>')
    .description('Retry a dead job')
    .action((id) => {
      const now = Math.floor(Date.now() / 1000);
      const result = db.prepare(`
        UPDATE jobs 
        SET state = 'pending', attempts = 0, run_at = ?, locked_by = NULL, updated_at = ? 
        WHERE id = ? AND state = 'dead'
      `).run(now, now, id);

      if (result.changes > 0) {
        console.log(`Job ${id} successfully moved back to pending.`);
      } else {
        console.error(`Error: Job ${id} not found in the DLQ.`);
      }
    });
}

module.exports = { registerDlqCommands };
