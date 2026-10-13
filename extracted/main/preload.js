"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");

// utils/config.ts
var import_electron_store = __toESM(require("electron-store"));
var config = new import_electron_store.default();
var config_default = config;

// main/preload.ts
var ipc = {
  desktop: true,
  reloadWindow() {
    return import_electron.ipcRenderer.send("reload-main-window" /* RELOAD_MAIN_WINDOW */);
  },
  minimizeWindow() {
    return import_electron.ipcRenderer.send("minimize-main-window" /* MINIMIZE_MAIN_WINDOW */);
  },
  toggleMaximize() {
    return import_electron.ipcRenderer.send("maximize-main-window" /* MAXIMIZE_MAIN_WINDOW */);
  },
  isMaximized() {
    return new Promise((resolve) => {
      import_electron.ipcRenderer.send("ismaximized-main-window" /* ISMAXIMIZED_MAIN_WINDOW */);
      import_electron.ipcRenderer.once(
        "ismaximized-result" /* ISMAXIMIZED_RESULT */,
        (_event, isMaximized) => {
          resolve(isMaximized);
        }
      );
    });
  },
  isFullscreen() {
    return new Promise((resolve) => {
      import_electron.ipcRenderer.send("isfullscreen-main-window" /* ISFULLSCREEN_MAIN_WINDOW */);
      import_electron.ipcRenderer.once(
        "isfullscreen-result" /* ISFULLSCREEN_RESULT */,
        (_event, isFullscreen) => {
          resolve(isFullscreen);
        }
      );
    });
  },
  closeWindow() {
    return import_electron.ipcRenderer.send("close-main-window" /* CLOSE_MAIN_WINDOW */);
  },
  async getCreds() {
    return await import_electron.ipcRenderer.invoke("get-creds" /* GET_CREDS */);
  },
  async getLanguageMap(code) {
    return await import_electron.ipcRenderer.invoke("get-language-map" /* GET_LANGUAGE_MAP */, code);
  },
  async getTemplates(posTemplateWidth) {
    return await import_electron.ipcRenderer.invoke(
      "get-templates" /* GET_TEMPLATES */,
      posTemplateWidth
    );
  },
  async initScheduler(time) {
    await import_electron.ipcRenderer.invoke("init-scheduler" /* INIT_SHEDULER */, time);
  },
  async selectFile(options) {
    return await import_electron.ipcRenderer.invoke(
      "select-file" /* SELECT_FILE */,
      options
    );
  },
  async getSaveFilePath(options) {
    return await import_electron.ipcRenderer.invoke(
      "save-dialog" /* GET_SAVE_FILEPATH */,
      options
    );
  },
  async getOpenFilePath(options) {
    return await import_electron.ipcRenderer.invoke(
      "open-dialog" /* GET_OPEN_FILEPATH */,
      options
    );
  },
  async checkDbAccess(filePath) {
    return await import_electron.ipcRenderer.invoke(
      "check-db-access" /* CHECK_DB_ACCESS */,
      filePath
    );
  },
  async checkForUpdates() {
    await import_electron.ipcRenderer.invoke("check-for-updates" /* CHECK_FOR_UPDATES */);
  },
  openLink(link) {
    import_electron.ipcRenderer.send("open-external" /* OPEN_EXTERNAL */, link);
  },
  async deleteFile(filePath) {
    return await import_electron.ipcRenderer.invoke(
      "delete-file" /* DELETE_FILE */,
      filePath
    );
  },
  async saveData(data, savePath) {
    await import_electron.ipcRenderer.invoke("save-data" /* SAVE_DATA */, data, savePath);
  },
  showItemInFolder(filePath) {
    import_electron.ipcRenderer.send("show-item-in-folder" /* SHOW_ITEM_IN_FOLDER */, filePath);
  },
  async makePDF(html, savePath, width, height) {
    return await import_electron.ipcRenderer.invoke(
      "save-html-as-pdf" /* SAVE_HTML_AS_PDF */,
      html,
      savePath,
      width,
      height
    );
  },
  async printDocument(html, width, height) {
    return await import_electron.ipcRenderer.invoke(
      "print-html-document" /* PRINT_HTML_DOCUMENT */,
      html,
      width,
      height
    );
  },
  async getDbList() {
    return await import_electron.ipcRenderer.invoke(
      "get-db-list" /* GET_DB_LIST */
    );
  },
  async getDbDefaultPath(companyName) {
    return await import_electron.ipcRenderer.invoke(
      "get-db-default-path" /* GET_DB_DEFAULT_PATH */,
      companyName
    );
  },
  async getEnv() {
    return await import_electron.ipcRenderer.invoke("get-env" /* GET_ENV */);
  },
  openExternalUrl(url) {
    import_electron.ipcRenderer.send("open-external" /* OPEN_EXTERNAL */, url);
  },
  async showError(title, content) {
    await import_electron.ipcRenderer.invoke("show-error" /* SHOW_ERROR */, { title, content });
  },
  async sendError(body) {
    await import_electron.ipcRenderer.invoke("send-error" /* SEND_ERROR */, body);
  },
  async sendAPIRequest(endpoint, options) {
    return await import_electron.ipcRenderer.invoke(
      "send-api-request" /* SEND_API_REQUEST */,
      endpoint,
      options
    );
  },
  registerMainProcessErrorListener(listener) {
    import_electron.ipcRenderer.on("main-process-error" /* LOG_MAIN_PROCESS_ERROR */, listener);
  },
  registerTriggerFrontendActionListener(listener) {
    import_electron.ipcRenderer.on("trigger-erpnext-sync" /* TRIGGER_ERPNEXT_SYNC */, listener);
  },
  registerConsoleLogListener(listener) {
    import_electron.ipcRenderer.on("console-log" /* CONSOLE_LOG */, listener);
  },
  db: {
    async getSchema() {
      return await import_electron.ipcRenderer.invoke(
        "db-schema" /* DB_SCHEMA */
      );
    },
    async create(dbPath, countryCode) {
      return await import_electron.ipcRenderer.invoke(
        "db-create" /* DB_CREATE */,
        dbPath,
        countryCode
      );
    },
    async connect(dbPath, countryCode) {
      return await import_electron.ipcRenderer.invoke(
        "db-connect" /* DB_CONNECT */,
        dbPath,
        countryCode
      );
    },
    async call(method, ...args) {
      return await import_electron.ipcRenderer.invoke(
        "db-call" /* DB_CALL */,
        method,
        ...args
      );
    },
    async bespoke(method, ...args) {
      return await import_electron.ipcRenderer.invoke(
        "db-bespoke" /* DB_BESPOKE */,
        method,
        ...args
      );
    }
  },
  store: {
    get(key) {
      return config_default.get(key);
    },
    set(key, value) {
      return config_default.set(key, value);
    },
    delete(key) {
      return config_default.delete(key);
    }
  }
};
import_electron.contextBridge.exposeInMainWorld("ipc", ipc);
//# sourceMappingURL=preload.js.map
