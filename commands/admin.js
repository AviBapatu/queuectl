function registerAdminCommands(program, db) {
  // --- STANDARD CLI UTILITIES ---
  program
    .command('clear')
    .description('Wipe the database and reset all queues (DANGER)')
    .option('-f, --force', 'Force clear without prompt')
    .action((options) => {
      if (!options.force) {
        console.error('[WARNING] This will delete all jobs, logs, and metrics.');
        console.error("Run 'queuectl clear --force' to confirm.");
        process.exit(1);
      }

      // Execute a clean wipe of the tables while preserving the schema
      db.exec(`
        DELETE FROM jobs;
        DELETE FROM workers;
      `);

      console.log('[OK] QueueCTL database successfully cleared.');
    });
}

module.exports = { registerAdminCommands };
