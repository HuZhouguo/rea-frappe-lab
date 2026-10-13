'use strict';
/**
 * schema.js — faithful subset of the schema map that Frappe Books builds in
 * `schemas/schemas.ts` (recovered from app.asar: main.js `getSchemas()`).
 *
 * Only the schemas touched by the voucher-draft chain are kept:
 *   JournalEntry (the accounting voucher, isSubmittable)
 *   JournalEntryAccount (its child table)
 *   NumberSeries (supplies the voucher name, e.g. "JV-1001")
 *   Account (FK target for JournalEntryAccount.account)
 *   Misc / SystemSettings (isSingle -> SingleValue table)
 */

const FieldType = {
  Data: 'Data',
  Int: 'Int',
  Float: 'Float',
  Currency: 'Currency',
  Check: 'Check',
  Date: 'Date',
  Datetime: 'Datetime',
  Text: 'Text',
  Select: 'Select',
  Link: 'Link',
  Attachment: 'Attachment',
  Table: 'Table',
};

/** schemas/meta/base.json */
const BASE_FIELDS = [
  { fieldname: 'createdBy', fieldtype: 'Data', required: true, meta: true },
  { fieldname: 'modifiedBy', fieldtype: 'Data', required: true, meta: true },
  { fieldname: 'created', fieldtype: 'Datetime', required: true, meta: true },
  { fieldname: 'modified', fieldtype: 'Datetime', required: true, meta: true },
];

/** schemas/meta/child.json */
const CHILD_FIELDS = [
  { fieldname: 'idx', fieldtype: 'Int', required: true, meta: true },
  { fieldname: 'parent', fieldtype: 'Data', required: true, meta: true },
  { fieldname: 'parentSchemaName', fieldtype: 'Data', required: true, meta: true },
  { fieldname: 'parentFieldname', fieldtype: 'Data', required: true, meta: true },
];

/** schemas/meta/submittable.json — combined with base by `getCombined` */
const SUBMITTABLE_FIELDS = [
  { fieldname: 'submitted', fieldtype: 'Check', required: true, meta: true },
  { fieldname: 'cancelled', fieldtype: 'Check', required: true, meta: true },
  ...BASE_FIELDS,
];

const JournalEntry = {
  name: 'JournalEntry',
  label: 'Journal Entry',
  naming: 'numberSeries',
  isSubmittable: true,
  fields: [
    { fieldname: 'name', fieldtype: 'Data', required: true, readOnly: true },
    {
      fieldname: 'numberSeries',
      fieldtype: 'Link',
      target: 'NumberSeries',
      required: true,
      default: 'JV-',
    },
    { fieldname: 'entryType', fieldtype: 'Select', required: true },
    { fieldname: 'date', fieldtype: 'Date', required: true },
    {
      fieldname: 'accounts',
      fieldtype: 'Table',
      target: 'JournalEntryAccount',
      required: true,
    },
    { fieldname: 'referenceNumber', fieldtype: 'Data' },
    { fieldname: 'referenceDate', fieldtype: 'Date' },
    { fieldname: 'userRemark', fieldtype: 'Text' },
    { fieldname: 'attachment', fieldtype: 'Attachment' },
  ],
  keywordFields: ['name', 'entryType'],
};

const JournalEntryAccount = {
  name: 'JournalEntryAccount',
  label: 'Journal Entry Account',
  isChild: true,
  fields: [
    { fieldname: 'account', fieldtype: 'Link', target: 'Account', required: true },
    { fieldname: 'debit', fieldtype: 'Currency' },
    { fieldname: 'credit', fieldtype: 'Currency' },
  ],
  tableFields: ['account', 'debit', 'credit'],
  keywordFields: ['account'],
};

const NumberSeries = {
  name: 'NumberSeries',
  label: 'Number Series',
  naming: 'manual',
  isSingle: false,
  isChild: false,
  fields: [
    { fieldname: 'name', fieldtype: 'Data', required: true },
    { fieldname: 'start', fieldtype: 'Int', default: 1001, required: true },
    { fieldname: 'padZeros', fieldtype: 'Int', default: 4, required: true },
    { fieldname: 'referenceType', fieldtype: 'Select' },
    { fieldname: 'current', fieldtype: 'Int' },
  ],
};

const Account = {
  name: 'Account',
  label: 'Account',
  isTree: false,
  naming: 'manual',
  fields: [
    { fieldname: 'name', fieldtype: 'Data', required: true },
    { fieldname: 'rootType', fieldtype: 'Select' },
    { fieldname: 'isGroup', fieldtype: 'Check' },
  ],
};

const Misc = {
  name: 'Misc',
  label: 'Misc',
  isSingle: true,
  fields: [
    { fieldname: 'openCount', fieldtype: 'Int' },
    { fieldname: 'useFullWidth', fieldtype: 'Check', default: false },
  ],
};

/** schemas/schemas.ts → addMetaFields() */
function addMetaFields(schemaMap) {
  for (const name in schemaMap) {
    const schema = schemaMap[name];
    if (schema.isSingle) {
      continue;
    }
    if (schema.isSubmittable) {
      schema.fields = [...schema.fields, ...SUBMITTABLE_FIELDS];
    } else if (schema.isChild) {
      schema.fields = [...schema.fields, ...CHILD_FIELDS];
    } else {
      schema.fields = [...schema.fields, ...BASE_FIELDS];
    }
  }
  return schemaMap;
}

/** main.js → NAME_FIELD: unshifted into every non-single schema without a `name`. */
const NAME_FIELD = {
  fieldname: 'name',
  label: 'ID',
  fieldtype: 'Data',
  required: true,
  readOnly: true,
};

/** schemas/schemas.ts → addNameField() */
function addNameField(schemaMap) {
  for (const name in schemaMap) {
    const schema = schemaMap[name];
    if (schema.isSingle) {
      continue;
    }
    const pkField = schema.fields.find((f) => f.fieldname === 'name');
    if (pkField !== undefined) {
      continue;
    }
    schema.fields.unshift({ ...NAME_FIELD });
  }
}

/** schemas/schemas.ts → setSchemaNameOnFields() */
function setSchemaNameOnFields(schemaMap) {
  for (const schemaName in schemaMap) {
    const schema = schemaMap[schemaName];
    schema.fields = schema.fields.map((f) => ({ ...f, schemaName }));
  }
  return schemaMap;
}

function getSchemas() {
  const schemaMap = {
    JournalEntry: structuredClone(JournalEntry),
    JournalEntryAccount: structuredClone(JournalEntryAccount),
    NumberSeries: structuredClone(NumberSeries),
    Account: structuredClone(Account),
    Misc: structuredClone(Misc),
  };
  addMetaFields(schemaMap);
  addNameField(schemaMap);
  setSchemaNameOnFields(schemaMap);
  return schemaMap;
}

module.exports = { getSchemas, FieldType, NAME_FIELD, addNameField };
