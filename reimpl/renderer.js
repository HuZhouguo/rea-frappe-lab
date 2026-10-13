'use strict';
/**
 * renderer.js — the renderer-process half, running in its own worker thread so
 * every db call really crosses a structured-clone boundary.
 *
 * Reproduces, end to end:
 *   form entry -> Doc (draft) -> Doc.sync() -> DatabaseHandler.insert()
 *   -> DatabaseDemux.call('insert') -> ipc.db.call('insert')
 *   -> ipcRenderer.invoke('db-call') -> [process boundary]
 *   -> ipcMain.handle('db-call') -> DatabaseManager.call('insert')
 *   -> DatabaseCore.insert() -> SQLite
 */

const { parentPort, workerData } = require('node:worker_threads');
const { createIpcRenderer } = require('./ipc');
const { buildIpcBridge } = require('./preload');
const { DatabaseDemux, DatabaseHandler } = require('./db-handler');
const { DocHandler } = require('./draft-doc');
const { Money } = require('./converter');

const say = (msg = '') => process.stdout.write(msg + '\n');

function wireTap(event) {
  if (event.direction === 'renderer:send') {
    const [first, ...rest] = event.args;
    const shown = event.channel.startsWith('db-')
      ? `ipcRenderer.invoke("${event.channel}", ${JSON.stringify(
          first
        )}${rest.length ? ', <payload>' : ''})`
      : `ipcRenderer.invoke("${event.channel}")`;
    say(`   → ${shown}`);
  }
}

function summarize(value, depth = 0) {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (value instanceof Date) {
    return `Date(${value.toISOString()})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => summarize(v, depth + 1)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    if (depth > 1) {
      return '{…}';
    }
    return `{${Object.entries(value)
      .map(([k, v]) => `${k}: ${summarize(v, depth + 1)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}

async function boot() {
  const ipcRenderer = createIpcRenderer(workerData.port, wireTap);
  const ipc = buildIpcBridge(ipcRenderer);

  // The minimum of `Fyo` the chain touches.
  const fyo = {
    auth: { session: { user: 'Administrator' } },
    pesa: (n) => new Money(Number(n).toFixed(2)),
    schemaMap: {},
  };

  const db = new DatabaseHandler(fyo, new DatabaseDemux(true, ipc));
  await db.connectToDatabase(workerData.dbPath, 'in');

  fyo.schemaMap = db.schemaMap;
  fyo.db = db;
  fyo.doc = new DocHandler(fyo);

  say('─'.repeat(78));
  say('STEP 0  Seed the two ledger accounts the voucher lines point at');
  say('        (FK targets must exist first: JournalEntryAccount.account -> Account)');
  say('─'.repeat(78));
  for (const account of [
    { name: 'Cash', rootType: 'Asset', isGroup: false },
    { name: 'Sales', rootType: 'Income', isGroup: false },
  ]) {
    const doc = fyo.doc.getNewDoc('Account', account);
    await doc.sync();
    say(`   Account "${doc.name}" inserted`);
  }

  say('');
  say('─'.repeat(78));
  say('STEP 1  Form entry creates an in-memory draft (nothing on disk yet)');
  say('─'.repeat(78));

  const draft = fyo.doc.getNewDoc('JournalEntry', {
    date: new Date('2026-10-13T00:00:00'),
    entryType: 'Journal Entry',
    userRemark: 'October adjustment',
  });
  draft.append('accounts', { account: 'Cash', debit: draft.fyo.pesa(1500), credit: draft.fyo.pesa(0) });
  draft.append('accounts', { account: 'Sales', debit: draft.fyo.pesa(0), credit: draft.fyo.pesa(1500) });

  say(`   notInserted=${draft.notInserted}  dirty=${draft.dirty}  status="${draft.status}"`);
  say(`   name=${String(draft.name)}   (no id assigned until the insert runs)`);

  say('');
  say('─'.repeat(78));
  say('STEP 2  Ctrl+S / Save button -> doc.sync() -> _insert()');
  say('─'.repeat(78));
  await draft.sync();
  say(`   name=${draft.name}  inserted=${draft.inserted}  status="${draft.status}"`);

  say('');
  say('─'.repeat(78));
  say('STEP 3  Edit the saved draft (in-memory dirty flag only)');
  say('─'.repeat(78));
  await draft.set('userRemark', 'October adjustment (revised)');
  say(`   dirty=${draft.dirty}  status="${draft.status}"`);

  say('');
  say('─'.repeat(78));
  say('STEP 4  Save again -> doc.sync() -> _update()');
  say('─'.repeat(78));
  await draft.sync();
  say(`   dirty=${draft.dirty}  status="${draft.status}"`);

  say('');
  say('─'.repeat(78));
  say('STEP 5  Re-read from SQLite through a cold doc cache (load())');
  say('─'.repeat(78));
  fyo.doc = new DocHandler(fyo);
  const reloaded = await fyo.doc.getDoc('JournalEntry', draft.name);
  say(`   name=${reloaded.name}  entryType=${reloaded.entryType}`);
  say(
    `   date=${reloaded.date?.toISOString()}  (a Date instance again after toDocValue;` +
      ` local midnight of ${reloaded.date?.toLocaleDateString('en-CA')})`
  );
  say(`   userRemark="${reloaded.userRemark}"  status="${reloaded.status}"`);
  say(
    `   accounts=${reloaded.accounts
      .map((a) => `${a.account} dr=${a.debit.store} cr=${a.credit.store} idx=${a.idx}`)
      .join(' | ')}`
  );

  say('');
  say('─'.repeat(78));
  say('STEP 6  Structured-clone probe: what the converter has to normalize');
  say('─'.repeat(78));
  const probe = await new Promise((resolve) => {
    workerData.probe.postMessage({
      date: new Date('2026-10-13T00:00:00'),
      money: fyo.pesa(1500),
      rawDateString: '2026-10-13',
    });
    workerData.probe.once('message', resolve);
  });
  say(`   sent Date            -> received ${summarize(probe.date)}`);
  say(`   sent Money instance  -> received ${summarize(probe.money)}  (prototype lost)`);
  say(`   sent "2026-10-13"    -> received ${summarize(probe.rawDateString)}  (unchanged)`);

  say('');
  say('─'.repeat(78));
  say('STEP 7  Handing back to the main process to dump the raw SQLite rows');
  say('─'.repeat(78));
  say(`   voucher ${draft.name} persisted; closing the connection is left to the main process.`);

  parentPort.postMessage({ done: true, name: draft.name });
}

boot().catch((err) => {
  parentPort.postMessage({ done: true, error: err.stack ?? String(err) });
});
