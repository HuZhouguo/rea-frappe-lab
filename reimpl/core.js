'use strict';
/**
 * core.js — port of `backend/database/core.ts` (DatabaseCore / Database class
 * recovered from main.js). Uses node:sqlite so the repro runs with zero
 * dependencies; the original uses knex + better-sqlite3 with identical SQL.
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const FieldType = {
  Table: 'Table',
};

/** main.js → sqliteTypeMap */
const sqliteTypeMap = {
  AutoComplete: 'text',
  Currency: 'text',
  Int: 'integer',
  Float: 'float',
  Percent: 'float',
  Check: 'boolean',
  Code: 'text',
  Date: 'date',
  Datetime: 'datetime',
  Time: 'time',
  Text: 'text',
  Data: 'text',
  Secret: 'text',
  Link: 'text',
  DynamicLink: 'text',
  Password: 'text',
  Select: 'text',
  Attachment: 'text',
  AttachImage: 'text',
  Color: 'text',
};

function getRandomString(length = 10) {
  return crypto.randomBytes(32).toString('base64url').slice(0, length);
}

const isNullOrUndef = (v) => v === null || v === undefined;

class DatabaseCore {
  constructor(dbPath) {
    this.typeMap = sqliteTypeMap;
    this.schemaMap = {};
    this.dbPath = dbPath ?? ':memory:';
    this.sqlite = new DatabaseSync(this.dbPath);
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.knex = this; // naming kept for parity with the original call sites
  }

  setSchemaMap(schemaMap) {
    this.schemaMap = schemaMap;
  }

  close() {
    this.sqlite.close();
  }

  /* ------------------------------ DDL / migrate ----------------------------- */

  migrate() {
    for (const [schemaName, schema] of Object.entries(this.schemaMap)) {
      if (!schema || schema.isSingle) {
        continue;
      }
      this.#createTable(schemaName);
    }
    this.#createSingleValueTable();
  }

  #createSingleValueTable() {
    this.sqlite.exec(
      'CREATE TABLE IF NOT EXISTS SingleValue (name text primary key, ' +
        'parent text, fieldname text, value text)'
    );
  }

  #createTable(schemaName) {
    const fields = this.schemaMap[schemaName].fields.filter((f) => !f.computed);
    const cols = [];
    const fks = [];
    for (const field of fields) {
      if (field.fieldtype === FieldType.Table) {
        continue;
      }
      const type = this.typeMap[field.fieldtype];
      if (!type) {
        continue;
      }
      let col = `"${field.fieldname}" ${type}`;
      if (field.fieldname === 'name') {
        col += ' primary key';
      }
      if (field.default !== undefined) {
        col += ` default ${sqliteLiteral(field.default)}`;
      }
      if (field.required) {
        col += ' not null';
      }
      cols.push(col);
      if (field.fieldtype === 'Link' && field.target) {
        const target = this.schemaMap[field.target];
        if (target && !target.isSingle) {
          fks.push(
            `foreign key ("${field.fieldname}") references "${target.name}"("name") ` +
              'on update cascade on delete restrict'
          );
        }
      }
    }
    this.sqlite.exec(
      `CREATE TABLE IF NOT EXISTS "${schemaName}" (${[...cols, ...fks].join(', ')})`
    );
  }

  /* --------------------------------- writes --------------------------------- */

  async insert(schemaName, fieldValueMap) {
    if (this.schemaMap[schemaName].isSingle) {
      await this.#updateSingleValues(schemaName, fieldValueMap);
    } else {
      await this.#insertOne(schemaName, fieldValueMap);
    }
    await this.#insertOrUpdateChildren(schemaName, fieldValueMap, false);
    return fieldValueMap;
  }

  async update(schemaName, fieldValueMap) {
    if (this.schemaMap[schemaName].isSingle) {
      await this.#updateSingleValues(schemaName, fieldValueMap);
    } else {
      await this.#updateOne(schemaName, fieldValueMap);
    }
    await this.#insertOrUpdateChildren(schemaName, fieldValueMap, true);
  }

  async delete(schemaName, name) {
    const schema = this.schemaMap[schemaName];
    if (schema.isSingle) {
      await this.#deleteSingle(schemaName, name);
      return;
    }
    this.sqlite.prepare(`DELETE FROM "${schemaName}" WHERE name = ?`).run(name);
    for (const field of this.#getTableFields(schemaName)) {
      await this.#deleteChildren(field.target, name);
    }
  }

  async deleteAll(schemaName, filters) {
    const { sql, params } = this.#buildWhere(filters);
    this.sqlite.prepare(`DELETE FROM "${schemaName}"${sql}`).run(...params);
    return 0;
  }

  async rename(schemaName, oldName, newName) {
    this.sqlite
      .prepare(`UPDATE "${schemaName}" SET name = ? WHERE name = ?`)
      .run(newName, oldName);
  }

  #insertOne(schemaName, fieldValueMap) {
    if (!fieldValueMap.name) {
      fieldValueMap.name = getRandomString();
    }
    const fields = this.schemaMap[schemaName].fields.filter(
      (f) => f.fieldtype !== FieldType.Table && !f.computed
    );
    const validMap = {};
    for (const { fieldname } of fields) {
      validMap[fieldname] = fieldValueMap[fieldname];
    }
    const cols = Object.keys(validMap);
    const placeholders = cols.map(() => '?').join(', ');
    this.sqlite
      .prepare(
        `INSERT INTO "${schemaName}" (${cols
          .map((c) => `"${c}"`)
          .join(', ')}) VALUES (${placeholders})`
      )
      .run(...cols.map((c) => toSqliteValue(validMap[c])));
  }

  async #updateOne(schemaName, fieldValueMap) {
    const updateMap = { ...fieldValueMap };
    delete updateMap.name;
    const schema = this.schemaMap[schemaName];
    for (const { fieldname, fieldtype, computed } of schema.fields) {
      if (fieldtype !== FieldType.Table && !computed) {
        continue;
      }
      // Table fields are stored in child tables; computed are never persisted.
      delete updateMap[fieldname];
    }
    const cols = Object.keys(updateMap);
    if (cols.length === 0) {
      return;
    }
    this.sqlite
      .prepare(
        `UPDATE "${schemaName}" SET ${cols
          .map((c) => `"${c}" = ?`)
          .join(', ')} WHERE name = ?`
      )
      .run(
        ...cols.map((c) => toSqliteValue(updateMap[c])),
        fieldValueMap.name
      );
  }

  async #insertOrUpdateChildren(schemaName, fieldValueMap, isUpdate) {
    let parentName = fieldValueMap.name;
    if (this.schemaMap[schemaName]?.isSingle) {
      parentName = schemaName;
    }

    for (const field of this.#getTableFields(schemaName)) {
      const added = [];
      const tableFieldValue = fieldValueMap[field.fieldname];
      if (isNullOrUndef(tableFieldValue)) {
        continue;
      }
      for (const child of tableFieldValue) {
        this.#prepareChild(schemaName, parentName, child, field, added.length);
        if (isUpdate && (await this.exists(field.target, child.name))) {
          await this.#updateOne(field.target, child);
        } else {
          this.#insertOne(field.target, child);
        }
        added.push(child.name);
      }
      if (isUpdate) {
        await this.#runDeleteOtherChildren(field, parentName, added);
      }
    }
  }

  #prepareChild(parentSchemaName, parentName, child, field, idx) {
    if (!child.name) {
      child.name ??= getRandomString();
    }
    child.parent = parentName;
    child.parentSchemaName = parentSchemaName;
    child.parentFieldname = field.fieldname;
    child.idx ??= idx;
  }

  async #runDeleteOtherChildren(field, parentName, added) {
    const builder = this.sqlite.prepare(
      `DELETE FROM "${field.target}" WHERE parent = ?` +
        (added.length ? ` AND name NOT IN (${added.map(() => '?').join(',')})` : '')
    );
    builder.run(parentName, ...added);
  }

  async #deleteChildren(schemaName, name) {
    this.sqlite.prepare(`DELETE FROM "${schemaName}" WHERE parent = ?`).run(name);
  }

  /* --------------------------------- reads ---------------------------------- */

  async get(schemaName, name = '', fields) {
    const schema = this.schemaMap[schemaName];
    if (!schema.isSingle && !name) {
      throw new Error('name is mandatory');
    }
    if (schema.isSingle) {
      return await this.#getSingle(schemaName);
    }
    if (typeof fields === 'string') {
      fields = [fields];
    }
    if (fields === undefined) {
      fields = schema.fields.filter((f) => !f.computed).map((f) => f.fieldname);
    }

    const allTableFields = this.#getTableFields(schemaName);
    const allTableFieldNames = allTableFields.map((f) => f.fieldname);
    const tableFields = allTableFields.filter((f) => fields.includes(f.fieldname));
    const nonTableFieldNames = fields.filter(
      (f) => !allTableFieldNames.includes(f)
    );

    let fieldValueMap = {};
    if (nonTableFieldNames.length) {
      const row = this.sqlite
        .prepare(
          `SELECT ${nonTableFieldNames
            .map((f) => `"${f}"`)
            .join(', ')} FROM "${schemaName}" WHERE name = ? LIMIT 1`
        )
        .get(name);
      fieldValueMap = row ?? {};
    }
    if (tableFields.length) {
      await this.#loadChildren(name, fieldValueMap, tableFields);
    }
    return fieldValueMap;
  }

  async getAll(schemaName, options = {}) {
    const schema = this.schemaMap[schemaName];
    if (schema === undefined) {
      throw new Error(`schema ${schemaName} not found`);
    }
    const hasCreated = !!schema.fields.find((f) => f.fieldname === 'created');
    const {
      fields = ['name'],
      filters,
      offset,
      limit,
      orderBy = hasCreated ? 'created' : undefined,
      order = 'desc',
    } = options;

    const fieldList = typeof fields === 'string' ? [fields] : fields;
    const { sql, params } = this.#buildWhere(filters ?? {});
    let query = `SELECT ${fieldList
      .map((f) => (f === '*' ? '*' : `"${f}"`))
      .join(', ')} FROM "${schemaName}"${sql}`;
    if (orderBy && orderBy !== 'name') {
      query += ` ORDER BY "${orderBy}" ${order === 'desc' ? 'DESC' : 'ASC'}`;
    }
    if (limit !== undefined) {
      query += ` LIMIT ${Number(limit)}`;
    }
    if (offset !== undefined) {
      // SQLite requires LIMIT before OFFSET.
      if (limit === undefined) {
        query += ' LIMIT -1';
      }
      query += ` OFFSET ${Number(offset)}`;
    }
    return this.sqlite.prepare(query).all(...params);
  }

  async exists(schemaName, name) {
    const schema = this.schemaMap[schemaName];
    if (schema.isSingle) {
      return this.#singleExists(schemaName);
    }
    let rows = [];
    try {
      const sql = name !== undefined
        ? `SELECT name FROM "${schemaName}" WHERE name = ? LIMIT 1`
        : `SELECT name FROM "${schemaName}" LIMIT 1`;
      rows = name !== undefined
        ? this.sqlite.prepare(sql).all(name)
        : this.sqlite.prepare(sql).all();
    } catch {
      return false;
    }
    return rows.length > 0;
  }

  async getSingleValues(...fieldnames) {
    const fieldnameList = fieldnames.map((f) =>
      typeof f === 'string' ? { fieldname: f } : f
    );
    const clauses = [];
    const params = [];
    for (const f of fieldnameList) {
      if (f.parent === undefined) {
        clauses.push('fieldname = ?');
        params.push(f.fieldname);
      } else {
        clauses.push('(fieldname = ? AND parent = ?)');
        params.push(f.fieldname, f.parent);
      }
    }
    return this.sqlite
      .prepare(
        `SELECT fieldname, value, parent FROM SingleValue WHERE ${clauses.join(
          ' OR '
        )}`
      )
      .all(...params);
  }

  /* -------------------------------- helpers -------------------------------- */

  #getTableFields(schemaName) {
    return this.schemaMap[schemaName].fields.filter(
      (f) => f.fieldtype === FieldType.Table
    );
  }

  async #loadChildren(parentName, fieldValueMap, tableFields) {
    for (const field of tableFields) {
      fieldValueMap[field.fieldname] = this.sqlite
        .prepare(
          `SELECT * FROM "${field.target}" WHERE parent = ? ORDER BY idx ASC`
        )
        .all(parentName);
    }
  }

  async #getSingle(schemaName) {
    const rows = this.sqlite
      .prepare('SELECT fieldname, value FROM SingleValue WHERE parent = ?')
      .all(schemaName);
    const map = { name: schemaName };
    for (const { fieldname, value } of rows) {
      map[fieldname] = value;
    }
    return map;
  }

  async #updateSingleValues(singleSchemaName, fieldValueMap) {
    const fields = this.schemaMap[singleSchemaName].fields.filter(
      (f) => !f.computed && f.fieldtype !== FieldType.Table
    );
    for (const field of fields) {
      const value = fieldValueMap[field.fieldname];
      if (value === undefined) {
        continue;
      }
      await this.#updateSingleValue(singleSchemaName, field.fieldname, value);
    }
  }

  async #updateSingleValue(singleSchemaName, fieldname, value) {
    const existing = this.sqlite
      .prepare('SELECT name FROM SingleValue WHERE parent = ? AND fieldname = ?')
      .all(singleSchemaName, fieldname);
    if (!existing.length) {
      this.sqlite
        .prepare(
          'INSERT INTO SingleValue (name, parent, fieldname, value) VALUES (?, ?, ?, ?)'
        )
        .run(getRandomString(), singleSchemaName, fieldname, String(value));
    } else {
      this.sqlite
        .prepare(
          'UPDATE SingleValue SET value = ? WHERE parent = ? AND fieldname = ?'
        )
        .run(String(value), singleSchemaName, fieldname);
    }
  }

  async #deleteSingle(schemaName, fieldname) {
    this.sqlite
      .prepare('DELETE FROM SingleValue WHERE parent = ? AND fieldname = ?')
      .run(schemaName, fieldname);
  }

  async #singleExists(singleSchemaName) {
    const rows = this.sqlite
      .prepare('SELECT count(*) AS count FROM SingleValue WHERE parent = ?')
      .all(singleSchemaName);
    return (rows[0]?.count ?? 0) > 0;
  }

  #buildWhere(filters) {
    const clauses = [];
    const params = [];
    for (const [column, value] of Object.entries(filters ?? {})) {
      if (Array.isArray(value)) {
        clauses.push(
          `"${column}" IN (${value.map(() => '?').join(', ')})`
        );
        params.push(...value.map(toSqliteValue));
      } else if (value === null) {
        clauses.push(`"${column}" IS NULL`);
      } else {
        clauses.push(`"${column}" = ?`);
        params.push(toSqliteValue(value));
      }
    }
    return {
      sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  /** bespoke: backend/database/bespoke.ts → getLastInserted */
  async getLastInserted(schemaName) {
    const rows = this.sqlite
      .prepare(
        `SELECT CAST(name AS INTEGER) AS num FROM "${schemaName}" ORDER BY num DESC LIMIT 1`
      )
      .all();
    const num = rows[0]?.num;
    return num === undefined || num === null ? 0 : num;
  }

  /** bespoke: raw read used for verification output in the repro */
  rawRows(schemaName) {
    return this.sqlite.prepare(`SELECT * FROM "${schemaName}"`).all();
  }
}

function toSqliteValue(v) {
  if (v === undefined) {
    return null;
  }
  if (typeof v === 'boolean') {
    return Number(v);
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  return v;
}

function sqliteLiteral(v) {
  if (typeof v === 'boolean') {
    return Number(v);
  }
  if (typeof v === 'number') {
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

module.exports = { DatabaseCore, getRandomString, sqliteTypeMap };
