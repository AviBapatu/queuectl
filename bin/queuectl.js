#!/usr/bin/env node

const { Command } = require('commander');
const db = require('../db');
const { registerJobCommands } = require('../commands/jobs');
const { registerMonitorCommands } = require('../commands/monitor');
const { registerWorkerCommands } = require('../commands/workers');
const { registerConfigCommands } = require('../commands/config');
const { registerDlqCommands } = require('../commands/dlq');
const { registerAdminCommands } = require('../commands/admin');

const program = new Command();

program
  .name('queuectl')
  .description('A robust, production-grade background job queue system.')
  .version('1.0.0')
  .addHelpText(
    'after',
    `
======================================================================
QueueCTL Manual (man)
======================================================================

DESCRIPTION:
  QueueCTL is a robust, SQLite-backed job processing system. It 
  guarantees atomic job claiming across multiple terminal processes
  and ensures worst-case crash recovery under 60 seconds.

CORE WORKFLOW:
  1. Add a job:        $ queuectl enqueue '{"command": "echo Hello"}'
  2. Start a worker:   $ queuectl worker start
  3. Check status:     $ queuectl status
  4. Stop gracefully:  $ queuectl worker stop

ADVANCED USAGE:
  Filter JSON:         $ queuectl list --state pending --json
  View Logs:           $ queuectl logs <job-id>
  System Health:       $ queuectl metrics
  Web Dashboard:       $ queuectl dashboard -p 3000
  Reset Queue:         $ queuectl clear --force

For command-specific help, run:
  $ queuectl <command> --help
======================================================================
`
  );

// Register modular command domains
registerJobCommands(program, db);
registerMonitorCommands(program, db);
registerWorkerCommands(program, db);
registerConfigCommands(program, db);
registerDlqCommands(program, db);
registerAdminCommands(program, db);
require('../commands/dashboard')(program, db);

program.parse(process.argv);
