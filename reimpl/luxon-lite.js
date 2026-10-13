'use strict';
/**
 * luxon-lite.js — the three DateTime operations the converter actually uses.
 * Luxon is bundled inside the renderer chunk rather than shipped in
 * node_modules, so it is re-expressed here to keep the repro dependency-free.
 *
 * Semantics match Luxon's defaults: `fromJSDate` reads the LOCAL calendar
 * date, `fromISO('YYYY-MM-DD')` is interpreted as local midnight.
 */

const pad = (n, len = 2) => String(n).padStart(len, '0');

class DateTime {
  constructor(jsDate) {
    this._d = jsDate;
  }
  static fromJSDate(jsDate) {
    return new DateTime(jsDate);
  }
  static fromISO(iso) {
    const str = String(iso);

    // A timezone designator (Z or ±hh:mm) means the instant is absolute, so
    // hand it to the native parser. Luxon behaves the same way.
    if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(str)) {
      return new DateTime(new Date(str));
    }

    // Bare YYYY-MM-DD (and offset-less timestamps) are local calendar values.
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/.exec(
      str
    );
    if (!m) {
      return new DateTime(new Date(NaN));
    }
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
      Number((m[7] ?? '0').padEnd(3, '0'))
    );
    return new DateTime(d);
  }
  toJSDate() {
    return this._d;
  }
  toISODate() {
    if (Number.isNaN(this._d.valueOf())) {
      return null;
    }
    return `${this._d.getFullYear()}-${pad(this._d.getMonth() + 1)}-${pad(
      this._d.getDate()
    )}`;
  }
}

module.exports = { DateTime };
