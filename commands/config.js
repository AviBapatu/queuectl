function registerConfigCommands(program, db) {
  // --- CONFIG COMMANDS ---
  program
    .command('config')
    .description('Manage configuration')
    .argument('<action>', 'set or get')
    .argument('<key>', 'Configuration key (e.g., max-retries, backoff-base, timeout_ms)')
    .argument('[value]', 'Value to set')
    .action((action, key, value) => {
      if (action === 'set') {
        if (!value) {
          console.error("Error: Value is required for 'set'.");
          process.exit(1);
        }
        db.prepare(`
          INSERT INTO config (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, value);
        console.log(`Config updated: ${key} = ${value}`);
      } else if (action === 'get') {
        const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
        if (row) {
          console.log(row.value);
        } else {
          console.log(`Config key '${key}' not found.`);
        }
      } else {
        console.error("Invalid action. Use 'set' or 'get'.");
        process.exit(1);
      }
    });
}

module.exports = { registerConfigCommands };
