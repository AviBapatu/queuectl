const db = require('./db');

function claimNextJob(workerPid) {
  const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

  // This query finds the oldest pending job that is ready to run (run_at <= now),
  // prioritizes by priority DESC then created_at ASC,
  // locks it to the current worker's PID, updates the heartbeat, and returns the job data.
  // All in ONE atomic operation using SQLite 3.35+ RETURNING clause.
  const stmt = db.prepare(`
    UPDATE jobs 
    SET 
        state = 'processing', 
        locked_by = ?, 
        heartbeat_at = ?, 
        updated_at = ?,
        attempts = attempts + 1 
    WHERE id = (
        SELECT id FROM jobs 
        WHERE state = 'pending' AND run_at <= ? 
        ORDER BY priority DESC, created_at ASC 
        LIMIT 1
    ) 
    RETURNING *;
  `);

  // Execute the statement synchronously
  const job = stmt.get(workerPid, now, now, now);

  return job;
}

module.exports = {
  claimNextJob,
};
