'use strict';
/**
 * db-handler.js — renderer side of the chain.
 *
 *  DatabaseDemux   <- fyo/demux/db.ts   (unwraps the { data | error } envelope)
 *  DatabaseHandler <- fyo/core/dbHandler.ts (converts DocValue <-> RawValue)
 *
 * DatabaseHandler is the object `Doc.sync()` calls (`this.fyo.db.insert(...)`).
 */

const { Converter } = require('./converter');

class DatabaseDemux {
  #isElectron = false;

  constructor(isElectron, ipc) {
    this.#isElectron = isElectron;
    this.ipc = ipc;
  }

  /** fyo/demux/db.ts → #handleDBCall() */
  async #handleDBCall(func) {
    const response = await func();

    if (response.error?.name) {
      const { name, message, stack } = response.error;
      const dberror = new Error(`${name}\n${message}`);
      dberror.name = 'DatabaseError';
      dberror.stack = stack;
      throw dberror;
    }

    return response.data;
  }

  async getSchemaMap() {
    return await this.#handleDBCall(async () => this.ipc.db.getSchema());
  }

  async createNewDatabase(dbPath, countryCode) {
    return await this.#handleDBCall(async () =>
      this.ipc.db.create(dbPath, countryCode)
    );
  }

  async connectToDatabase(dbPath, countryCode) {
    return await this.#handleDBCall(async () =>
      this.ipc.db.connect(dbPath, countryCode)
    );
  }

  async call(method, ...args) {
    return await this.#handleDBCall(async () =>
      this.ipc.db.call(method, ...args)
    );
  }

  async callBespoke(method, ...args) {
    return await this.#handleDBCall(async () =>
      this.ipc.db.bespoke(method, ...args)
    );
  }
}

class DatabaseHandler {
  #demux;
  #schemaMap = {};
  #fieldMap = {};
  dbPath;

  constructor(fyo, demux) {
    this.fyo = fyo;
    this.#demux = demux;
    this.converter = new Converter(this);
  }

  get schemaMap() {
    return this.#schemaMap;
  }

  get fieldMap() {
    return this.#fieldMap;
  }

  get isConnected() {
    return !!this.dbPath;
  }

  async connectToDatabase(dbPath, countryCode) {
    countryCode = await this.#demux.connectToDatabase(dbPath, countryCode);
    await this.init();
    this.dbPath = dbPath;
    return countryCode;
  }

  async init() {
    this.#schemaMap = await this.#demux.getSchemaMap();
    this.#setFieldMap();
  }

  #setFieldMap() {
    this.#fieldMap = Object.values(this.schemaMap).reduce((acc, sch) => {
      if (!sch?.name) {
        return acc;
      }
      acc[sch.name] = Object.fromEntries(
        sch.fields.map((f) => [f.fieldname, f])
      );
      return acc;
    }, {});
  }

  /* ------------------------------- writes ---------------------------------- */

  async insert(schemaName, docValueMap) {
    let rawValueMap = this.converter.toRawValueMap(schemaName, docValueMap);
    rawValueMap = await this.#demux.call('insert', schemaName, rawValueMap);
    return this.converter.toDocValueMap(schemaName, rawValueMap);
  }

  async update(schemaName, docValueMap) {
    const rawValueMap = this.converter.toRawValueMap(schemaName, docValueMap);
    await this.#demux.call('update', schemaName, rawValueMap);
  }

  async delete(schemaName, name) {
    await this.#demux.call('delete', schemaName, name);
  }

  /* -------------------------------- reads ---------------------------------- */

  async get(schemaName, name, fields) {
    const rawValueMap = await this.#demux.call('get', schemaName, name, fields);
    return this.converter.toDocValueMap(schemaName, rawValueMap);
  }

  async getAll(schemaName, options = {}) {
    const rawValueMap = await this.#demux.call('getAll', schemaName, options);
    return this.converter.toDocValueMap(schemaName, rawValueMap);
  }

  async exists(schemaName, name) {
    return await this.#demux.call('exists', schemaName, name);
  }

  async getLastInserted(schemaName) {
    return await this.#demux.callBespoke('getLastInserted', schemaName);
  }

  async count(schemaName, options = {}) {
    const rows = await this.#demux.call('getAll', schemaName, options);
    return rows.length;
  }

  async close() {
    await this.#demux.call('close');
  }
}

module.exports = { DatabaseDemux, DatabaseHandler };
