'use strict';
/**
 * main-process.js — the main-process half of the Electron app, reduced to the
 * database channels. Mirrors `main/registerIpcMainActionListeners.ts`.
 */

const { DatabaseManager } = require('./db-manager');
const { getErrorHandledResponse } = require('./ipc');

const manager = new DatabaseManager();

function registerIpcMainActionListeners(ipcMain) {
  ipcMain.handle('db-schema', async () => {
    return await getErrorHandledResponse(() => manager.getSchemaMap());
  });

  ipcMain.handle('db-connect', async (_, dbPath, countryCode) => {
    return await getErrorHandledResponse(async () => {
      return await manager.connectToDatabase(dbPath, countryCode);
    });
  });

  // The channel every voucher save travels through.
  ipcMain.handle('db-call', async (_, method, ...args) => {
    return await getErrorHandledResponse(async () => {
      return await manager.call(method, ...args);
    });
  });

  ipcMain.handle('db-bespoke', async (_, method, ...args) => {
    return await getErrorHandledResponse(async () => {
      return await manager.callBespoke(method, ...args);
    });
  });
}

module.exports = { registerIpcMainActionListeners, manager };
