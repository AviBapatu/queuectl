const path = require('path');
const { fork } = require('child_process');

function registerWorkerCommands(program, db) {
  // --- Helper function for worker start ---
  function handleWorkerStart(countStr) {
    const count = parseInt(countStr || '1', 10);
    console.log(
      `Starting ${count} worker process(es)... Press Ctrl+C to gracefully shut down.`
    );

    const workerPath = path.resolve(__dirname, '../worker.js');
    const childProcesses = [];

    for (let i = 0; i < count; i++) {
      const child = fork(workerPath);
      childProcesses.push(child);
    }

    // Forward shutdown signals from parent CLI process to child worker processes
    function shutdownChildren() {
      console.log('\n[CLI] Forwarding shutdown signal to worker processes...');
      for (const child of childProcesses) {
        try {
          child.kill('SIGTERM');
        } catch (e) {
          // Child might have already exited
        }
      }
    }

    process.on('SIGINT', shutdownChildren);
    process.on('SIGTERM', shutdownChildren);
  }

  // --- Helper function for worker stop (Remote IPC with Ghost PID fix) ---
  function handleWorkerStop() {
    const workers = db.prepare('SELECT pid FROM workers').all();

    if (workers.length === 0) {
      console.log('No active workers found.');
      return;
    }

    let signaledCount = 0;
    for (const worker of workers) {
      try {
        process.kill(worker.pid, 'SIGTERM');
        signaledCount++;
      } catch (err) {
        if (err.code === 'ESRCH') {
          // The Ghost PID fix: Process doesn't exist anymore, clean it up
          db.prepare('DELETE FROM workers WHERE pid = ?').run(worker.pid);
        }
      }
    }
    console.log(`Sent shutdown signal to ${signaledCount} worker(s).`);
  }

  // --- WORKER START/STOP (TOP-LEVEL & NESTED SUPPORT) ---
  program
    .command('worker-start')
    .description('Start workers in the foreground')
    .option('--count <number>', 'Number of worker processes', '1')
    .action((options) => handleWorkerStart(options.count));

  program
    .command('worker-stop')
    .description('Gracefully stop all running workers from another terminal')
    .action(() => handleWorkerStop());

  const workerCmd = program.command('worker').description('Manage worker processes');

  workerCmd
    .command('start')
    .description('Start workers in the foreground')
    .option('--count <number>', 'Number of worker processes', '1')
    .action((options) => handleWorkerStart(options.count));

  workerCmd
    .command('stop')
    .description('Gracefully stop all running workers from another terminal')
    .action(() => handleWorkerStop());
}

module.exports = { registerWorkerCommands };
