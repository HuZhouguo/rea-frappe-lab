'use strict';
/**
 * preload.js — the `db` slice of the object published by
 * `main/preload.ts` via `contextBridge.exposeInMainWorld('ipc', ipc)`.
 *
 * Only the `db` namespace is reproduced; it is the whole surface the voucher
 * draft chain uses.
 */

function buildIpcBridge(ipcRenderer) {
  return {
    db: {
      getSchema: () => ipcRenderer.invoke('db-schema'),
      create: (dbPath, countryCode) =>
        ipcRenderer.invoke('db-create', dbPath, countryCode),
      connect: (dbPath, countryCode) =>
        ipcRenderer.invoke('db-connect', dbPath, countryCode),
      call: (method, ...args) => ipcRenderer.invoke('db-call', method, ...args),
      bespoke: (method, ...args) =>
        ipcRenderer.invoke('db-bespoke', method, ...args),
    },
  };
}

module.exports = { buildIpcBridge };
