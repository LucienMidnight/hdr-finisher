const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSplashWindow } = require('../lib/splash-window');

test('an unavailable splash is diagnosed, but normal splash teardown is quiet', async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  class FailedWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
    destroyed = false;
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    loadFile() { return Promise.reject(new Error('failed to load')); }
  }
  const open = () => createSplashWindow({ BrowserWindow: FailedWindow, app: { getVersion: () => '1.0.0' } });
  const failed = open();
  await Promise.resolve();
  assert.equal(warnings.mock.callCount(), 1);
  assert.equal(failed.isOpen(), true);
  failed.close();
  open().close();
  await Promise.resolve();
  assert.equal(warnings.mock.callCount(), 1);
});
