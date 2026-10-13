'use strict';
/**
 * converter.js — faithful port of `fyo/core/converter.ts`.
 *
 * This is the layer that makes the payload IPC-safe. Doc values use rich JS
 * types (Date, DateTime, Pesa/Money, parsed Attachment objects). None of those
 * survive Electron's structured-clone IPC, so `toRawValueMap` flattens
 * everything into string | number | null before it crosses the process boundary.
 */

const { DateTime } = require('./luxon-lite');

class Money {
  constructor(store) {
    this.store = String(store);
  }
  copy() {
    return new Money(this.store);
  }
  toString() {
    return this.store;
  }
  valueOf() {
    return Number(this.store);
  }
}

const isPesa = (v) => v instanceof Money;
const isNullOrUndef = (v) => v === null || v === undefined;

class Converter {
  constructor(db) {
    this.db = db;
    this.fyo = { pesa: (n) => new Money(Number(n).toFixed(2)) };
  }

  toDocValueMap(schemaName, rawValueMap) {
    rawValueMap ??= {};
    if (Array.isArray(rawValueMap)) {
      return rawValueMap.map((rv) => this.#toDocValueMap(schemaName, rv));
    }
    return this.#toDocValueMap(schemaName, rawValueMap);
  }

  toRawValueMap(schemaName, docValueMap) {
    docValueMap ??= {};
    if (Array.isArray(docValueMap)) {
      return docValueMap.map((dv) => this.#toRawValueMap(schemaName, dv));
    }
    return this.#toRawValueMap(schemaName, docValueMap);
  }

  static toDocValue(value, field, fyo) {
    switch (field.fieldtype) {
      case 'Currency':
        return toDocCurrency(value, field, fyo);
      case 'Date':
      case 'Datetime':
        return toDocDate(value, field);
      case 'Int':
        return toDocInt(value, field);
      case 'Float':
        return toDocFloat(value, field);
      case 'Check':
        return toDocCheck(value, field);
      case 'Attachment':
        return toDocAttachment(value, field);
      default:
        return toDocString(value, field);
    }
  }

  static toRawValue(value, field, fyo) {
    switch (field.fieldtype) {
      case 'Currency':
        return toRawCurrency(value, fyo, field);
      case 'Date':
        return toRawDate(value, field);
      case 'Datetime':
        return toRawDateTime(value, field);
      case 'Int':
        return toRawInt(value, field);
      case 'Float':
        return toRawFloat(value, field);
      case 'Check':
        return toRawCheck(value, field);
      case 'Link':
        return toRawLink(value, field);
      case 'Attachment':
        return toRawAttachment(value, field);
      default:
        return toRawString(value, field);
    }
  }

  #toDocValueMap(schemaName, rawValueMap) {
    const fieldValueMap = this.db.fieldMap[schemaName];
    const docValueMap = {};
    for (const fieldname in rawValueMap) {
      const field = fieldValueMap[fieldname];
      const rawValue = rawValueMap[fieldname];
      if (!field) {
        continue;
      }
      if (Array.isArray(rawValue)) {
        const parentSchemaName = field.target;
        docValueMap[fieldname] = rawValue.map((rv) =>
          this.#toDocValueMap(parentSchemaName, rv)
        );
      } else {
        docValueMap[fieldname] = Converter.toDocValue(rawValue, field, this.fyo);
      }
    }
    return docValueMap;
  }

  #toRawValueMap(schemaName, docValueMap) {
    const fieldValueMap = this.db.fieldMap[schemaName];
    const rawValueMap = {};
    for (const fieldname in docValueMap) {
      const field = fieldValueMap[fieldname];
      const docValue = docValueMap[fieldname];
      if (Array.isArray(docValue)) {
        const parentSchemaName = field.target;
        rawValueMap[fieldname] = docValue.map((value) => {
          // In the app a table field holds Doc instances; both paths end up
          // recursively raw-converted.
          const dict =
            value && typeof value.getValidDict === 'function'
              ? value.getValidDict()
              : value;
          return this.#toRawValueMap(parentSchemaName, dict);
        });
      } else {
        rawValueMap[fieldname] = Converter.toRawValue(docValue, field, this.fyo);
      }
    }
    return rawValueMap;
  }
}

/* ------------------------------ doc direction ----------------------------- */

function toDocString(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throwError(value, field, 'doc');
}

function toDocDate(value, field) {
  if (value instanceof Date) {
    return value;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throwError(value, field, 'doc');
  }
  return DateTime.fromISO(value).toJSDate();
}

function toDocCurrency(value, field, fyo) {
  if (isPesa(value)) {
    return value;
  }
  if (value === '' || value === null) {
    return fyo.pesa(0);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return fyo.pesa(value);
  }
  if (typeof value === 'boolean') {
    return fyo.pesa(Number(value));
  }
  throwError(value, field, 'doc');
}

function toDocInt(value, field) {
  if (value === '') {
    return 0;
  }
  if (typeof value === 'string') {
    value = parseInt(value, 10);
  }
  return toDocFloat(value, field);
}

function toDocFloat(value, field) {
  if (value === '') {
    return 0;
  }
  if (typeof value === 'boolean') {
    return Number(value);
  }
  if (typeof value === 'string') {
    value = parseFloat(value);
  }
  if (value === null) {
    value = 0;
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  throwError(value, field, 'doc');
}

function toDocCheck(value, field) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return !!parseFloat(value);
  }
  if (typeof value === 'number') {
    return Boolean(value);
  }
  throwError(value, field, 'doc');
}

function toDocAttachment(value, field) {
  if (!value) {
    return null;
  }
  if (typeof value !== 'string') {
    throwError(value, field, 'doc');
  }
  try {
    return JSON.parse(value) || null;
  } catch {
    throwError(value, field, 'doc');
  }
}

/* ------------------------------ raw direction ----------------------------- */

function toRawCurrency(value, fyo, field) {
  if (isPesa(value)) {
    return value.store;
  }
  if (isNullOrUndef(value)) {
    return fyo.pesa(0).store;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return fyo.pesa(value).store;
  }
  throwError(value, field, 'raw');
}

function toRawInt(value, field) {
  if (typeof value === 'string') {
    return parseInt(value, 10);
  }
  if (isNullOrUndef(value)) {
    return 0;
  }
  if (typeof value === 'number') {
    return Math.floor(value);
  }
  throwError(value, field, 'raw');
}

function toRawFloat(value, field) {
  if (typeof value === 'string') {
    return parseFloat(value);
  }
  if (isNullOrUndef(value)) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  throwError(value, field, 'raw');
}

function toRawDate(value, field) {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    value = new Date(value);
  }
  if (value instanceof Date) {
    return DateTime.fromJSDate(value).toISODate();
  }
  throwError(value, field, 'raw');
}

function toRawDateTime(value, field) {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throwError(value, field, 'raw');
}

function toRawCheck(value, field) {
  if (typeof value === 'number') {
    value = Boolean(value);
  }
  if (typeof value === 'boolean') {
    return Number(value);
  }
  throwError(value, field, 'raw');
}

function toRawString(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throwError(value, field, 'raw');
}

function toRawLink(value, field) {
  if (value === null || !value?.length) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throwError(value, field, 'raw');
}

function toRawAttachment(value, field) {
  if (!value) {
    return null;
  }
  if (value?.name && value?.data && value?.type) {
    return JSON.stringify(value);
  }
  throwError(value, field, 'raw');
}

function throwError(value, field, type) {
  throw new Error(
    `invalid ${type} conversion '${String(value)}' of type ${typeof value} found, ` +
      `field: ${JSON.stringify(field)}`
  );
}

module.exports = { Converter, Money, isPesa };
