import "@testing-library/jest-dom/vitest";

// TD22 (2026-05-24): Node 26 ships an experimental `localStorage` global that
// is exposed by default but returns undefined unless the process was started
// with `--localstorage-file`. That Node-provided descriptor shadows the one
// jsdom installs on its own window, so vitest's populateGlobal() step can't
// promote jsdom's working Storage objects onto the worker's globalThis. Tests
// that touch `globalThis.localStorage` (writeQueue, scorecard repros, stale-
// failure dialog, submit flow) crash with `Cannot read properties of undefined
// (reading 'clear')` in beforeEach. Rebind directly from the JSDOM instance
// vitest exposes at globalThis.jsdom. Only runs under jsdom env (where the
// `jsdom` global exists); node-env tests are untouched.
const dom = (globalThis as unknown as { jsdom?: { window?: Window } }).jsdom;
if (dom?.window?.localStorage && dom?.window?.sessionStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: dom.window.sessionStorage,
    configurable: true,
    writable: true,
  });
}
