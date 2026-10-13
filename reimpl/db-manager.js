'use strict';
/**
 * db-manager.js — port of `backend/database/manager.ts` (DatabaseManager).
 * This is the only object the `db-call` IPC channel is allowed to touch:
 * it whitelists the method name before dispatching onto DatabaseCore.
 */

const { getSchemas } = require('./schema');
const { DatabaseCore } = require('./core');

/** main.js → databaseMethodSet */
const databaseMethodSet = new Set([
  'insert',
  'get',
  'getAll',
  'getSingleValues',
  'rename',
  'update',
  'delete',
  'deleteAll',
  'close',
  'exists',
]);

/** backend/database/bespoke.ts → BespokeQueries (only what the chain needs) */
const BespokeQueries = {
  getLastInserted: async (db, schemaName) => db.getLastInserted(schemaName),
};

class DatabaseManager {
  #isInitialized = false;
  db = undefined;

  async connectToDatabase(dbPath, countryCode) {
    this.db = new DatabaseCore(dbPath);
    this.db.setSchemaMap(getSchemas());
    this.db.migrate();
    this.#isInitialized = true;
    return countryCode ?? 'in';
  }

  getSchemaMap() {
    return this.db?.schemaMap ?? getSchemas();
  }

  /** main.js → DatabaseManager.call(): the `db-call` target */
  async call(method, ...args) {
    if (!this.#isInitialized) {
      return;
    }
    if (!databaseMethodSet.has(method)) {
      return;
    }
    const response = await this.db[method](...args);
    if (method === 'close') {
      delete this.db;
    }
    return response;
  }

  /** main.js → DatabaseManager.callBespoke(): the `db-bespoke` target */
  async callBespoke(method, ...args) {
    if (!this.#isInitialized) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(BespokeQueries, method)) {
      throw new Error(`invalid bespoke db function ${method}`);
    }
    return await BespokeQueries[method](this.db, ...args);
  }
}

module.exports = { DatabaseManager, databaseMethodSet };
