'use strict';
/**
 * draft-doc.js — port of `fyo/model/doc.ts` (the Doc base class) plus
 * `fyo/model/naming.ts` and `models/helpers.ts#getDocStatus`.
 *
 * This is where the word "Draft" actually comes from. A "draft" is NOT a
 * separate entity on disk: `notInserted` marks a doc that exists only in the
 * `fyo.doc` in-memory cache, and `getDocStatus()` renders that state as "Draft".
 * A saved voucher whose `submitted` is still 0 also reports "Draft".
 */

const { Money, isPesa, Converter } = require('./converter');
const { getRandomString } = require('./core');

const DEFAULT_USER = 'Administrator';
const DEFAULT_SERIES_START = 1001;

const pad = (prefix, next, padZeros) =>
  prefix + String(next).padStart(padZeros ?? 4, '0');

class Doc {
  constructor(fyo, schema, initialValues = {}, setDefaults = true, convertToDocValue = false) {
    this._dirty = true;
    this._notInserted = true;
    this._syncing = false;
    this.fyo = fyo;
    this.schema = schema;

    for (const { fieldname } of schema.fields) {
      this[fieldname] = null;
    }
    if (setDefaults) {
      this._setDefaults();
    }
    this._setValuesWithoutChecks(initialValues, convertToDocValue);
  }

  get schemaName() {
    return this.schema.name;
  }
  get notInserted() {
    return this._notInserted;
  }
  get inserted() {
    return !this._notInserted;
  }
  get dirty() {
    return this._dirty;
  }
  get tableFields() {
    return this.schema.fields.filter((f) => f.fieldtype === 'Table');
  }
  get isSubmitted() {
    return !!this.submitted && !this.cancelled;
  }
  get isCancelled() {
    return !!this.submitted && !!this.cancelled;
  }
  get canDelete() {
    if (this.notInserted || this.schema.isSingle || this.schema.isChild) {
      return false;
    }
    return true;
  }
  get canSave() {
    const submittable = this.schema.isSubmittable;
    return !(
      (submittable && this.submitted) ||
      (submittable && this.cancelled) ||
      !this.dirty ||
      this.schema.isChild
    );
  }
  get canSubmit() {
    return !(
      !this.schema.isSubmittable ||
      this.dirty ||
      this.notInserted ||
      this.submitted ||
      this.cancelled
    );
  }

  /** models/helpers.ts → getDocStatus() */
  get status() {
    if (this.notInserted) {
      return 'Draft';
    }
    if (this.dirty) {
      return 'NotSaved';
    }
    if (!this.schema.isSubmittable) {
      return 'Saved';
    }
    if (this.cancelled) {
      return 'Cancelled';
    }
    if (this.submitted) {
      return 'Submitted';
    }
    return 'Draft';
  }

  /* ------------------------------ value access ------------------------------ */

  get(fieldname) {
    return this[fieldname];
  }

  async set(fieldname, value) {
    if (this.fieldMapMissing(fieldname) || value === undefined) {
      return false;
    }
    if (this[fieldname] === value) {
      return false;
    }
    this[fieldname] = value;
    this._dirty = true;
    return true;
  }

  fieldMapMissing(fieldname) {
    return !this.schema.fields.some((f) => f.fieldname === fieldname);
  }

  async setAndSync(fieldname, value) {
    await this.set(fieldname, value);
    await this.sync();
  }

  append(fieldname, value = {}) {
    this.push(fieldname, value);
    this._dirty = true;
    const list = this[fieldname];
    return list[list.length - 1];
  }

  /** fyo/model/doc.ts → push() */
  push(fieldname, docValueMap = {}, convertToDocValue = false) {
    const childDocs = [
      this[fieldname] ?? [],
      this._getChildDoc(docValueMap, fieldname, convertToDocValue),
    ].flat();
    childDocs.forEach((child, idx) => (child.idx = idx));
    this[fieldname] = childDocs;
  }

  /** fyo/model/doc.ts → _getChildDoc() */
  _getChildDoc(docValueMap, fieldname, convertToDocValue = false) {
    if (!this.name && this.schema.naming !== 'manual') {
      this.name = this.fyo.doc.getTemporaryName(this.schema);
    }

    docValueMap.name ??= getRandomString();

    // Child meta fields are filled in here, on the renderer side.
    docValueMap.parent ??= this.name;
    docValueMap.parentSchemaName ??= this.schemaName;
    docValueMap.parentFieldname ??= fieldname;

    if (docValueMap instanceof Doc) {
      docValueMap.parentdoc ??= this;
      return docValueMap;
    }

    const childSchemaName = this.schema.fields.find(
      (f) => f.fieldname === fieldname
    ).target;
    const childDoc = this.fyo.doc.getNewDoc(
      childSchemaName,
      docValueMap,
      false,
      convertToDocValue
    );
    childDoc.parentdoc ??= this;
    return childDoc;
  }

  _setDefaults() {
    for (const field of this.schema.fields) {
      if (field.default !== undefined) {
        this[field.fieldname] = field.default;
      }
    }
  }

  /** fyo/model/doc.ts → _setValuesWithoutChecks() */
  _setValuesWithoutChecks(data, convertToDocValue = false) {
    for (const field of this.schema.fields) {
      const { fieldname, fieldtype } = field;
      const value = data?.[fieldname];

      if (Array.isArray(value)) {
        for (const row of value) {
          this.push(fieldname, row, convertToDocValue);
        }
      } else if (fieldtype === 'Currency' && typeof value === 'number') {
        this[fieldname] = this.fyo.pesa(value);
      } else if (value !== undefined && !convertToDocValue) {
        this[fieldname] = value;
      } else if (value !== undefined) {
        this[fieldname] = Converter.toDocValue(value, field, this.fyo);
      } else {
        this[fieldname] = this[fieldname] ?? null;
      }

      if (fieldtype === 'Table' && !this[fieldname]) {
        this[fieldname] = [];
      }
    }
  }

  _clearValues() {
    for (const { fieldname } of this.schema.fields) {
      this[fieldname] = null;
    }
    this._dirty = true;
    this._notInserted = true;
  }

  /** The exact projection that gets serialized over IPC. */
  getValidDict(filterMeta = false, filterComputed = false) {
    let fields = this.schema.fields;
    if (filterMeta) {
      fields = fields.filter((f) => !f.meta);
    }
    if (filterComputed) {
      fields = fields.filter((f) => !f.computed);
    }

    const data = {};
    for (const field of fields) {
      let value = this[field.fieldname];
      if (Array.isArray(value)) {
        value = value.map((doc) => doc.getValidDict(filterMeta, filterComputed));
      }
      if (isPesa(value)) {
        value = value.copy();
      }
      if (value === null && this.schema.isSingle) {
        continue;
      }
      data[field.fieldname] = value;
    }
    return data;
  }

  /* --------------------------------- meta ---------------------------------- */

  _setBaseMetaValues() {
    if (this.schema.isSubmittable) {
      this.submitted = false;
      this.cancelled = false;
    }
    if (!this.createdBy) {
      this.createdBy = this.fyo.auth.session.user || DEFAULT_USER;
    }
    if (!this.created) {
      this.created = new Date();
    }
    this._updateModifiedMetaValues();
  }

  _updateModifiedMetaValues() {
    this.modifiedBy = this.fyo.auth.session.user || DEFAULT_USER;
    this.modified = new Date();
  }

  /* ------------------------------- persistence ------------------------------ */

  async _insert() {
    this._setBaseMetaValues();
    await this._preSync();
    await setName(this, this.fyo);

    const validDict = this.getValidDict(false, true);
    const data = await this.fyo.db.insert(this.schemaName, validDict);
    await this._syncValues(data);
    return this;
  }

  async _update() {
    await this._validateDbNotModified();
    this._updateModifiedMetaValues();
    await this._preSync();

    const data = this.getValidDict(false, true);
    await this.fyo.db.update(this.schemaName, data);
    await this._syncValues(data);
    return this;
  }

  async _preSync() {
    this._setChildDocsParent();
    await this._validateSync();
  }

  async _validateSync() {
    for (const { fieldname, required, label } of this.schema.fields) {
      if (!required || this.schema.isChild === false) {
        continue;
      }
      // (Child docs are validated through their parent in the original.)
      void fieldname;
      void label;
    }
  }

  /** fyo/model/doc.ts → _setChildDocsParent() */
  _setChildDocsParent() {
    for (const { fieldname } of this.tableFields) {
      const value = this.get(fieldname);
      if (!Array.isArray(value)) {
        continue;
      }
      for (const childDoc of value) {
        if (childDoc.parent) {
          continue;
        }
        childDoc.parent = this.name;
      }
    }
  }

  async _validateDbNotModified() {
    if (this.notInserted || !this.name || this.schema.isSingle) {
      return;
    }
    const dbValues = await this.fyo.db.get(this.schemaName, this.name);
    const docModified = this.modified?.toISOString?.();
    const dbModified = dbValues.modified?.toISOString?.();
    if (dbValues && docModified !== dbModified) {
      const err = new Error(
        `ConflictError: ${this.schema.label} ${this.name} has been modified after ` +
          `loading please reload entry. ${dbModified}, ${docModified}`
      );
      err.name = 'ConflictError';
      throw err;
    }
  }

  async _syncValues(data) {
    this._clearValues();
    this._setValuesWithoutChecks(data);
    this._dirty = false;
  }

  /** Doc.sync() — the single entry point every save goes through. */
  async sync() {
    this._syncing = true;
    let doc;
    if (this.notInserted) {
      doc = await this._insert();
    } else {
      doc = await this._update();
    }
    this._notInserted = false;
    this._syncing = false;
    return doc;
  }

  async load() {
    if (this.name === undefined) {
      return;
    }
    const data = await this.fyo.db.get(this.schemaName, this.name);
    if (data && data.name) {
      await this._syncValues(data);
    } else {
      const err = new Error(`Not Found: ${this.schemaName} ${this.name}`);
      err.name = 'NotFoundError';
      throw err;
    }
    this._notInserted = false;
  }

  async delete() {
    if (!this.canDelete) {
      return;
    }
    await this.fyo.db.delete(this.schemaName, this.name);
  }
}

/* -------------------------- fyo/model/naming.ts ---------------------------- */

async function setName(doc, fyo) {
  if (doc.schema.naming === 'manual') {
    return;
  }
  if (doc.schema.naming === 'autoincrement') {
    return (doc.name = await getNextId(doc.schemaName, fyo));
  }
  if (doc.numberSeries !== undefined) {
    return (doc.name = await getSeriesNext(doc.numberSeries, doc.schemaName, fyo));
  }
  if (doc.schema.isSingle) {
    return (doc.name = doc.schemaName);
  }
  if (!doc.name) {
    doc.name = getRandomString();
  }
  return doc.name;
}

async function getNextId(schemaName, fyo) {
  const lastInserted = await fyo.db.getLastInserted(schemaName);
  return String(lastInserted + 1).padStart(9, '0');
}

async function getSeriesNext(prefix, schemaName, fyo) {
  let series;
  try {
    series = await fyo.doc.getDoc('NumberSeries', prefix);
  } catch {
    await createNumberSeries(prefix, schemaName, DEFAULT_SERIES_START, fyo);
    series = await fyo.doc.getDoc('NumberSeries', prefix);
  }
  return await series.next(schemaName);
}

async function createNumberSeries(prefix, referenceType, start, fyo) {
  if (await fyo.db.exists('NumberSeries', prefix)) {
    return;
  }
  const series = fyo.doc.getNewDoc('NumberSeries', {
    name: prefix,
    start,
    referenceType,
  });
  await series.sync();
}

/** fyo/models/NumberSeries.ts */
class NumberSeries extends Doc {
  setCurrent() {
    let current = this.get('current');
    if (!current) {
      current = this.get('start');
    } else {
      current = current + 1;
    }
    this.current = current;
  }

  async next(schemaName) {
    this.setCurrent();
    const exists = await this.checkIfCurrentExists(schemaName);
    if (exists) {
      this.current = this.current + 1;
    }
    await this.sync();
    return this.getPaddedName(this.current);
  }

  async checkIfCurrentExists(schemaName) {
    if (!schemaName) {
      return true;
    }
    return await this.fyo.db.exists(schemaName, this.getPaddedName(this.current));
  }

  getPaddedName(next) {
    return pad(this.name, next, this.padZeros);
  }
}

/* ---------------------- fyo/core/docHandler.ts (subset) -------------------- */

class DocHandler {
  constructor(fyo) {
    this.fyo = fyo;
    this.cache = new Map();
  }

  getNewDoc(schemaName, initialValues = {}, setDefaults = true, convertToDocValue = false) {
    const schema = this.fyo.schemaMap[schemaName];
    const doc =
      schemaName === 'NumberSeries'
        ? new NumberSeries(this.fyo, schema, initialValues, setDefaults, convertToDocValue)
        : new Doc(this.fyo, schema, initialValues, setDefaults, convertToDocValue);

    if (doc.name) {
      const key = `${schemaName}:${doc.name}`;
      this.cache.set(key, doc);
    }
    return doc;
  }

  /** fyo/core/docHandler.ts → getTemporaryName(): a placeholder id for new docs. */
  getTemporaryName(schema) {
    if (schema.naming === 'autoincrement' || schema.naming === 'manual') {
      return getRandomString();
    }
    return getRandomString();
  }

  async getDoc(schemaName, name) {
    const key = `${schemaName}:${name}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const doc = this.getNewDoc(schemaName, {}, false);
    doc.name = name;
    await doc.load();
    this.cache.set(key, doc);
    return doc;
  }
}

module.exports = { Doc, NumberSeries, DocHandler, setName, getDocStatus: (d) => d.status };
