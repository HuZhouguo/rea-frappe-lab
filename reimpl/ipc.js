'use strict';
/**
 * ipc.js — minimal stand-in for Electron's ipcRenderer / ipcMain pair.
 *
 * Transport is a `MessageChannel` between two worker threads, so payloads go
 * through the SAME structured-clone serialization Electron uses. That is the
 * detail that matters here: it is why Dates, Pesa/Money instances and Attachment
 * objects must be flattened by the converter before they cross.
 */

/** main-process side: `ipcMain.handle(channel, handler)` */
function createIpcMain(port, tap) {
  const handlers = new Map();

  port.on('message', async (msg) => {
    const { id, channel, args } = msg;
    tap?.({ direction: 'main:recv', channel, args });
    const handler = handlers.get(channel);
    if (!handler) {
      port.postMessage({
        id,
        response: {
          error: {
            name: 'Error',
            message: `No handler registered for '${channel}'`,
          },
        },
      });
      return;
    }
    // Electron does not wrap: the handler's return value IS the reply. The
    // { data | error } envelope is produced explicitly inside each handler
    // (see `getErrorHandledReponse` in main-process.js).
    let response;
    try {
      response = await handler({}, ...args);
    } catch (err) {
      response = {
        error: { name: err.name, message: err.message, stack: err.stack, code: err.code },
      };
    }
    tap?.({ direction: 'main:send', channel, response });
    port.postMessage({ id, response });
  });

  return {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    on(channel, fn) {
      handlers.set(channel, (event, ...args) => {
        fn(event, ...args);
        return undefined;
      });
    },
  };
}

/** main.js → getErrorHandledReponse(): the { data | error } envelope */
async function getErrorHandledResponse(func) {
  const response = {};
  try {
    response.data = await func();
  } catch (err) {
    response.error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
    };
  }
  return response;
}

/** renderer side: the object that `contextBridge.exposeInMainWorld('ipc', ...)` publishes */
function createIpcRenderer(port, tap) {
  let seq = 0;
  const pending = new Map();

  port.on('message', ({ id, response }) => {
    const entry = pending.get(id);
    if (!entry) {
      return;
    }
    pending.delete(id);
    tap?.({ direction: 'renderer:recv', channel: entry.channel, response });
    entry.resolve(response);
  });

  const invoke = (channel, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, channel });
      tap?.({ direction: 'renderer:send', channel, args });
      port.postMessage({ id, channel, args });
    });

  const send = (channel, ...args) => {
    port.postMessage({ id: ++seq, channel, args });
  };

  return { invoke, send };
}

module.exports = { createIpcMain, createIpcRenderer, getErrorHandledResponse };
