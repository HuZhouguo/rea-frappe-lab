'use strict';
/**
 * run.js — starts the two processes and drives the reproduction.
 *
 *   this file            = the "main process" (owns ipcMain + SQLite)
 *   renderer.js (worker) = the "renderer process" (owns the form + preload ipc)
 *
 *   node run.js            # SQLite in memory
 *   node run.js /tmp/jv.db # SQLite on disk (inspect with: sqlite3 /tmp/jv.db)
 */

const path = require('node:path');
const { Worker, MessageChannel } = require('node:worker_threads');
const { createIpcMain } = require('./ipc');
const { registerIpcMainActionListeners, manager } = require('./main-process');

const dbPath = process.argv[2] ?? ':memory:';

const { port1: mainSidePort, port2: rendererSidePort } = new MessageChannel();
const probePort = new MessageChannel();

/** Echo whatever arrives, so the renderer can inspect it post-clone. */
probePort.port1.on('message', (msg) => probePort.port1.postMessage(msg));

function mainTap(event) {
  if (event.direction !== 'main:recv') {
    return;
  }
  const [first, ...rest] = event.args;
  if (first === 'close') {
    return;
  }
  const detail =
    event.channel === 'db-call' && rest.length
      ? ` args=[${rest.map((a) => JSON.stringify(a)).join(', ')}]`
      : '';
  process.stdout.write(
    `   [main] ${event.channel}(${JSON.stringify(first)})${detail}\n`
  );
}

const ipcMain = createIpcMain(mainSidePort, mainTap);
registerIpcMainActionListeners(ipcMain);

const renderer = new Worker(path.join(__dirname, 'renderer.js'), {
  workerData: {
    port: rendererSidePort,
    probe: probePort.port2,
    dbPath,
  },
  transferList: [rendererSidePort, probePort.port2],
});

renderer.on('message', (msg) => {
  if (msg?.error) {
    process.stdout.write(`\nRENDERER ERROR\n${msg.error}\n`);
    process.exitCode = 1;
  }
  dumpRows();
  probePort.port1.close();
  mainSidePort.close();
  renderer.terminate();
});

renderer.on('error', (err) => {
  process.stdout.write(`\nWORKER ERROR\n${err.stack}\n`);
  process.exitCode = 1;
});

function dumpRows() {
  const out = [];
  out.push('');
  out.push('─'.repeat(78));
  out.push('SQLite: SELECT * FROM JournalEntry');
  out.push('─'.repeat(78));
  for (const row of manager.db.rawRows('JournalEntry')) {
    out.push(JSON.stringify(row, null, 2));
  }
  out.push('');
  out.push('─'.repeat(78));
  out.push('SQLite: SELECT * FROM JournalEntryAccount  (child rows)');
  out.push('─'.repeat(78));
  for (const row of manager.db.rawRows('JournalEntryAccount')) {
    out.push(JSON.stringify(row, null, 2));
  }
  out.push('');
  out.push('─'.repeat(78));
  out.push('SQLite: SELECT * FROM NumberSeries');
  out.push('─'.repeat(78));
  for (const row of manager.db.rawRows('NumberSeries')) {
    out.push(JSON.stringify(row, null, 2));
  }
  process.stdout.write(out.join('\n') + '\n');
}
