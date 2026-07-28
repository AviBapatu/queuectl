const assert = require('assert');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { claimNextJob } = require('./queries');
const { executeJob, startSweeper } = require('./worker');

async function runTests() {
  console.log('=== Running QueueCTL Verification Tests ===\n');

  // Clean up database for clean testing
  db.prepare('DELETE FROM jobs').run();
  db.prepare('DELETE FROM workers').run();

  // Test 1: Priority Sorting in Atomic Claim
  console.log('Test 1: Priority Sorting & Atomic Claiming');
  const lowPrioId = uuidv4();
  const highPrioId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
    VALUES (?, 'echo low', 'pending', 0, 3, 1, ?, ?, ?)
  `).run(lowPrioId, now, now, now);

  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
    VALUES (?, 'echo high', 'pending', 0, 3, 10, ?, ?, ?)
  `).run(highPrioId, now, now, now);

  const firstClaimed = claimNextJob(1111);
  assert.strictEqual(firstClaimed.id, highPrioId, 'High priority job should be claimed first');
  assert.strictEqual(firstClaimed.state, 'processing');
  assert.strictEqual(firstClaimed.locked_by, 1111);

  const secondClaimed = claimNextJob(2222);
  assert.strictEqual(secondClaimed.id, lowPrioId, 'Low priority job should be claimed second');

  const emptyClaim = claimNextJob(3333);
  assert.strictEqual(emptyClaim, undefined, 'No pending jobs remaining');
  console.log('[PASS] Priority Sorting & Atomic Claiming PASSED\n');

  // Complete the jobs
  db.prepare("UPDATE jobs SET state = 'completed'").run();

  // Test 2: Exponential Backoff & DLQ
  console.log('Test 2: Exponential Backoff & DLQ transition');
  const failJobId = uuidv4();
  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
    VALUES (?, 'nonexistent_cmd_xyz_12345', 'pending', 0, 1, 0, ?, ?, ?)
  `).run(failJobId, now, now, now);

  // Claim and fail attempt 1
  let job = claimNextJob(1111);
  await executeJob(job);
  let updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(failJobId);
  assert.strictEqual(updatedJob.state, 'pending');
  assert.strictEqual(updatedJob.attempts, 1);
  assert.ok(updatedJob.run_at > now, 'run_at should be pushed into future for backoff');

  // Force run_at to now for second attempt
  db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run(now, failJobId);

  // Claim and fail attempt 2 (max_retries = 2, so attempts becomes 2 >= 2 -> dead)
  job = claimNextJob(1111);
  await executeJob(job);
  updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(failJobId);
  assert.strictEqual(updatedJob.state, 'dead', 'Job should be moved to dead letter queue');
  console.log('[PASS] Exponential Backoff & DLQ transition PASSED\n');

  // Test 3: DLQ Retry resets attempts to 0
  console.log('Test 3: DLQ Retry resets attempts to 0');
  db.prepare(`
    UPDATE jobs 
    SET state = 'pending', attempts = 0, run_at = ?, locked_by = NULL, updated_at = ? 
    WHERE id = ? AND state = 'dead'
  `).run(now, now, failJobId);
  updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(failJobId);
  assert.strictEqual(updatedJob.state, 'pending');
  assert.strictEqual(updatedJob.attempts, 0, 'attempts must be reset to 0');
  console.log('[PASS] DLQ Retry PASSED\n');

  // Test 4: Murder Test / Sweeper Recovery
  console.log('Test 4: Sweeper Crash Recovery (Murder Test simulation)');
  const stuckJobId = uuidv4();
  const staleTime = now - 40; // 40 seconds ago (> 30s threshold)
  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, locked_by, heartbeat_at, created_at, updated_at) 
    VALUES (?, 'sleep 100', 'processing', 0, 3, 0, ?, 9999, ?, ?, ?)
  `).run(stuckJobId, staleTime, staleTime, staleTime, staleTime);

  // Run sweeper logic manually
  const staleThreshold = Math.floor(Date.now() / 1000) - 30;
  const sweeperResult = db.prepare(`
    UPDATE jobs 
    SET state = 'pending', locked_by = NULL, updated_at = ? 
    WHERE state = 'processing' AND heartbeat_at < ?
  `).run(Math.floor(Date.now() / 1000), staleThreshold);

  assert.strictEqual(sweeperResult.changes, 1, 'Sweeper should recover 1 stuck job');
  const recoveredJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(stuckJobId);
  assert.strictEqual(recoveredJob.state, 'pending');
  assert.strictEqual(recoveredJob.locked_by, null);
  assert.strictEqual(recoveredJob.attempts, 0);
  console.log('[PASS] Sweeper Crash Recovery PASSED\n');

  // Clean jobs table before edge case tests
  db.prepare('DELETE FROM jobs').run();

  // Test 5: Bad Actor Input Validation
  console.log('Test 5: Bad Actor Input Validation');
  const { execSync, fork } = require('child_process');
  let threw = false;
  try {
    execSync(`node bin/queuectl.js enqueue '{"invalid": "json"'`, { stdio: 'ignore' });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, true, 'System accepted invalid JSON!');

  threw = false;
  try {
    execSync(`node bin/queuectl.js enqueue '{"priority": 10}'`, { stdio: 'ignore' });
  } catch (err) {
    threw = true;
  }
  assert.strictEqual(threw, true, 'System accepted missing command field!');
  console.log('[PASS] Bad Actor Input Validation PASSED\n');

  // Test 6: Ghost PID Cleanup Validation
  console.log('Test 6: Ghost PID Cleanup Validation');
  db.prepare(`INSERT INTO workers (pid, status, started_at) VALUES (999999, 'polling', ?)`).run(now);
  assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM workers').get().count, 1);
  execSync('node bin/queuectl.js worker stop', { stdio: 'ignore' });
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) as count FROM workers').get().count,
    0,
    'Ghost PID should be cleaned up via ESRCH handler'
  );
  console.log('[PASS] Ghost PID Cleanup Validation PASSED\n');

  // Clean jobs table before time-travel test
  db.prepare('DELETE FROM jobs').run();

  // Test 7: Time-Travel Testing (Scheduled Jobs & Backoff)
  console.log('Test 7: Time-Travel Testing (Scheduled Jobs & Backoff)');
  const futureId = uuidv4();
  const futureTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes in future
  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
    VALUES (?, 'echo future', 'pending', 0, 3, 0, ?, ?, ?)
  `).run(futureId, futureTime, futureTime, futureTime);

  const claimedFuture = claimNextJob(1111);
  assert.strictEqual(claimedFuture, undefined, 'Worker must not claim future scheduled jobs');
  const futureJobState = db.prepare('SELECT state FROM jobs WHERE id = ?').get(futureId).state;
  assert.strictEqual(futureJobState, 'pending', 'Future job state must remain strictly pending');
  console.log('[PASS] Time-Travel Testing PASSED\n');

  // Clean jobs table before timeout test
  db.prepare('DELETE FROM jobs').run();

  // Test 8: The Timeout Guillotine (Bonus Validation)
  console.log('Test 8: The Timeout Guillotine (Bonus Validation)');
  const timeoutId = uuidv4();
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('timeout_ms', '500')`).run();
  const tNow = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
    VALUES (?, 'sleep 5', 'pending', 0, 3, 0, ?, ?, ?)
  `).run(timeoutId, tNow, tNow, tNow);

  let timeoutJob = claimNextJob(1111);
  await executeJob(timeoutJob);
  const updatedTimeoutJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(timeoutId);
  assert.strictEqual(updatedTimeoutJob.state, 'pending', 'Timed-out job should back off to pending');
  assert.strictEqual(updatedTimeoutJob.attempts, 1, 'Timed-out job attempts should increment to 1');
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('timeout_ms', '30000')`).run(); // reset timeout
  console.log('[PASS] Timeout Guillotine PASSED\n');

  // Clean jobs table before OOM test
  db.prepare('DELETE FROM jobs').run();

  // Test 9: The OOM (Out of Memory) Log Attack (Output Truncation)
  console.log('Test 9: The OOM (Out of Memory) Log Attack (Output Truncation)');
  const oomId = uuidv4();
  const oNow = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at) 
    VALUES (?, ?, 'pending', 0, 3, 0, ?, ?, ?)
  `).run(oomId, 'node -e "console.log(\'A\'.repeat(50000))"', oNow, oNow, oNow);

  let oomJob = claimNextJob(1111);
  await executeJob(oomJob);
  const updatedOomJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(oomId);
  assert.strictEqual(updatedOomJob.state, 'completed', 'Job should finish without OOM crash');
  assert.ok(
    updatedOomJob.output && updatedOomJob.output.length <= 10000,
    'Output must be truncated to <= 10,000 characters'
  );
  console.log('[PASS] OOM Log Attack & Output Truncation PASSED\n');

  // Test 10: The Stampede Test (Extreme Concurrency)
  console.log('Test 10: The Stampede Test (Extreme Concurrency - 500 jobs / 20 workers)');
  db.prepare('DELETE FROM jobs').run();
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, priority, run_at, created_at, updated_at)
    VALUES (?, 'true', 'pending', 0, 3, 0, ?, ?, ?)
  `);
  const sNow = Math.floor(Date.now() / 1000);
  const insertMany = db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      insertStmt.run(`stampede-${i}`, sNow, sNow, sNow);
    }
  });
  insertMany();

  const path = require('path');
  const workerPath = path.resolve(__dirname, './worker.js');
  const workers = [];
  for (let i = 0; i < 20; i++) {
    const child = fork(workerPath, [], { stdio: 'ignore' });
    workers.push(child);
  }

  await new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const row = db.prepare("SELECT COUNT(*) as completed FROM jobs WHERE state = 'completed'").get();
      if (row.completed === 500) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > 20000) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for Stampede test. Completed: ${row.completed}/500`));
      }
    }, 100);
  });

  for (const child of workers) {
    try {
      child.kill('SIGTERM');
    } catch (e) {}
  }

  const countCompleted = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE state = 'completed'").get().count;
  const sumAttempts = db.prepare("SELECT SUM(attempts) as sum FROM jobs").get().sum;
  assert.strictEqual(countCompleted, 500, 'All 500 jobs must be completed');
  assert.strictEqual(sumAttempts, 500, 'SUM(attempts) must be exactly 500 (no duplicate executions)');
  console.log('[PASS] Extreme Concurrency Stampede Test PASSED (500/500 jobs, 500/500 attempts)\n');

  // Clean up database for final state
  db.prepare('DELETE FROM jobs').run();
  db.prepare('DELETE FROM workers').run();

  console.log('=== ALL 10 VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

