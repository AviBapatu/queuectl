// commands/dashboard.js

module.exports = function (program, db) {
  program
    .command('dashboard')
    .description('Launch a detailed real-time web dashboard')
    .option('-p, --port <number>', 'Port to run the server on', '3000')
    .action((options) => {
      const express = require('express');
      const app = express();
      const port = options.port;

      // Helper function to format Unix timestamps
      const formatTime = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString() : 'N/A');

      app.get('/', (req, res) => {
        // 1. Fetch Aggregated States
        const states = db.prepare(`SELECT state, COUNT(*) as count FROM jobs GROUP BY state`).all();
        const stateMap = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
        states.forEach((s) => {
          stateMap[s.state] = s.count;
        });

        // 2. Fetch Detailed Active Workers
        const workers = db
          .prepare(`SELECT pid, started_at FROM workers ORDER BY started_at DESC`)
          .all();

        // 3. Fetch Jobs Currently Processing
        const processingJobs = db
          .prepare(
            `
          SELECT id, command, locked_by, attempts, heartbeat_at 
          FROM jobs 
          WHERE state = 'processing' 
          ORDER BY updated_at DESC
        `
          )
          .all();

        // 4. Fetch Next Up (Pending Queue - Top 10)
        const pendingJobs = db
          .prepare(
            `
          SELECT id, command, priority, created_at, run_at 
          FROM jobs 
          WHERE state = 'pending' 
          ORDER BY priority DESC, created_at ASC 
          LIMIT 10
        `
          )
          .all();

        // 5. NEW: Fetch Recent History (Completed or Dead - Top 10)
        const historyJobs = db
          .prepare(
            `
          SELECT id, command, state, attempts, updated_at 
          FROM jobs 
          WHERE state IN ('completed', 'dead') 
          ORDER BY updated_at DESC 
          LIMIT 10
        `
          )
          .all();

        // 6. Build HTML Rows for Tables
        const workerRows =
          workers
            .map(
              (w) => `
          <tr class="border-b border-gray-100 text-sm">
            <td class="py-3 text-purple-700 font-mono font-medium">PID: ${w.pid}</td>
            <td class="py-3 text-gray-500">Online since ${formatTime(w.started_at)}</td>
          </tr>
        `
            )
            .join('') ||
          `<tr><td colspan="2" class="py-4 text-gray-400 text-center italic">No active workers</td></tr>`;

        const processingRows =
          processingJobs
            .map(
              (j) => `
          <tr class="border-b border-gray-100 text-sm">
            <td class="py-3 text-gray-500 font-mono text-xs">${j.id.split('-')[0]}...</td>
            <td class="py-3 text-yellow-700 font-mono font-medium truncate max-w-xs">${
              j.command
            }</td>
            <td class="py-3 text-gray-600">Worker ${j.locked_by || 'Unknown'}</td>
            <td class="py-3 text-gray-600">Attempt ${j.attempts + 1}</td>
            <td class="py-3 text-gray-500">Last heartbeat: ${formatTime(j.heartbeat_at)}</td>
          </tr>
        `
            )
            .join('') ||
          `<tr><td colspan="5" class="py-4 text-gray-400 text-center italic">No jobs currently processing</td></tr>`;

        const pendingRows =
          pendingJobs
            .map(
              (j) => `
          <tr class="border-b border-gray-100 text-sm">
            <td class="py-3 text-gray-500 font-mono text-xs">${j.id.split('-')[0]}...</td>
            <td class="py-3 text-blue-700 font-mono font-medium truncate max-w-xs">${j.command}</td>
            <td class="py-3 text-gray-600 font-semibold">Priority: ${j.priority}</td>
            <td class="py-3 text-gray-500">Enqueued: ${formatTime(j.created_at)}</td>
          </tr>
        `
            )
            .join('') ||
          `<tr><td colspan="4" class="py-4 text-gray-400 text-center italic">Queue is empty</td></tr>`;

        // NEW: Build History Rows
        const historyRows =
          historyJobs
            .map((j) => {
              const stateColor = j.state === 'completed' ? 'text-green-600' : 'text-red-600';
              return `
          <tr class="border-b border-gray-100 text-sm">
            <td class="py-3 text-gray-500 font-mono text-xs">${j.id.split('-')[0]}...</td>
            <td class="py-3 text-gray-800 font-mono font-medium truncate max-w-xs">${j.command}</td>
            <td class="py-3 font-bold uppercase tracking-wider text-xs ${stateColor}">${j.state}</td>
            <td class="py-3 text-gray-600">Attempt ${j.attempts + 1}</td>
            <td class="py-3 text-gray-500">Finished: ${formatTime(j.updated_at)}</td>
          </tr>
        `;
            })
            .join('') ||
          `<tr><td colspan="5" class="py-4 text-gray-400 text-center italic">No history yet</td></tr>`;

        // 7. Render the Full Dashboard (Light Theme)
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>QueueCTL Mission Control</title>
            <meta http-equiv="refresh" content="2"> 
            <script src="https://cdn.tailwindcss.com"></script>
          </head>
          <body class="bg-gray-50 text-gray-900 font-sans p-8">
            <div class="max-w-6xl mx-auto">
              
              <div class="flex justify-between items-end mb-8 border-b border-gray-200 pb-4">
                <div>
                  <h1 class="text-3xl font-bold tracking-tight text-gray-900">QueueCTL Mission Control</h1>
                  <p class="text-gray-500 mt-1">Real-time system monitoring</p>
                </div>
                <div class="text-xs text-gray-400 font-mono bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">
                  Auto-refreshing every 2s
                </div>
              </div>

              <div class="grid grid-cols-6 gap-4 mb-8">
                <div class="bg-white p-5 rounded-lg border border-gray-200 border-t-4 border-t-blue-500 shadow-sm">
                  <div class="text-3xl font-bold text-gray-800">${stateMap.pending}</div>
                  <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mt-1">Pending</div>
                </div>
                <div class="bg-white p-5 rounded-lg border border-gray-200 border-t-4 border-t-yellow-500 shadow-sm">
                  <div class="text-3xl font-bold text-gray-800">${stateMap.processing}</div>
                  <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mt-1">Processing</div>
                </div>
                <div class="bg-white p-5 rounded-lg border border-gray-200 border-t-4 border-t-green-500 shadow-sm">
                  <div class="text-3xl font-bold text-gray-800">${stateMap.completed}</div>
                  <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mt-1">Completed</div>
                </div>
                <div class="bg-white p-5 rounded-lg border border-gray-200 border-t-4 border-t-orange-500 shadow-sm">
                  <div class="text-3xl font-bold text-gray-800">${stateMap.failed}</div>
                  <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mt-1">Backing Off</div>
                </div>
                <div class="bg-white p-5 rounded-lg border border-gray-200 border-t-4 border-t-red-500 shadow-sm">
                  <div class="text-3xl font-bold text-gray-800">${stateMap.dead}</div>
                  <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mt-1">DLQ (Dead)</div>
                </div>
                <div class="bg-white p-5 rounded-lg border border-gray-200 border-t-4 border-t-purple-500 shadow-sm">
                  <div class="text-3xl font-bold text-gray-800">${workers.length}</div>
                  <div class="text-gray-500 text-xs font-bold uppercase tracking-wider mt-1">Active Workers</div>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-8">
                
                <div class="col-span-2 space-y-8">
                  
                  <div class="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                    <h2 class="text-lg font-bold mb-4 text-gray-800 uppercase tracking-wide text-sm border-b border-gray-100 pb-2">
                      <span class="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-2"></span>Jobs in Flight (Processing)
                    </h2>
                    <table class="w-full text-left">
                      <tbody>
                        ${processingRows}
                      </tbody>
                    </table>
                  </div>

                  <div class="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                    <h2 class="text-lg font-bold mb-4 text-gray-800 uppercase tracking-wide text-sm border-b border-gray-100 pb-2">
                      <span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2"></span>Next Up (Pending Queue)
                    </h2>
                    <table class="w-full text-left">
                      <tbody>
                        ${pendingRows}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="col-span-1">
                  <div class="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                    <h2 class="text-lg font-bold mb-4 text-gray-800 uppercase tracking-wide text-sm border-b border-gray-100 pb-2">
                      <span class="inline-block w-2 h-2 rounded-full bg-purple-500 mr-2"></span>Worker Fleet
                    </h2>
                    <table class="w-full text-left">
                      <tbody>
                        ${workerRows}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                <div class="col-span-3">
                  <div class="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                    <h2 class="text-lg font-bold mb-4 text-gray-800 uppercase tracking-wide text-sm border-b border-gray-100 pb-2">
                      <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>Recent History (Completed & Dead)
                    </h2>
                    <table class="w-full text-left">
                      <tbody>
                        ${historyRows}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>
          </body>
          </html>
        `;
        res.send(html);
      });

      app.listen(port, () => {
        console.log(`\n[QueueCTL] Detailed Web Dashboard running at: http://localhost:${port}`);
        console.log(`Press Ctrl+C to stop the server.\n`);
      });
    });
};
