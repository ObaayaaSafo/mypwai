// Re-export — the main implementation lives in zkbridge.ts.
// This file exists so stale cache/import references still resolve.
import {
  zkInit, zkTerminate, zkGetDeviceCount, zkOpenDevice, zkCloseDevice,
  zkInitDB, zkCapture, zkIdentify, zkLoadTemplates, zkAddTemplate,
  zkClearDB, zkGetCount, zkRemoveTemplate,
  isDeviceOpen, isDBReady,
} from './zkbridge.js';

export {
  zkInit, zkTerminate, zkGetDeviceCount, zkOpenDevice, zkCloseDevice,
  zkInitDB, zkCapture, zkIdentify, zkLoadTemplates, zkAddTemplate,
  zkClearDB, zkGetCount, zkRemoveTemplate,
  isDeviceOpen, isDBReady,
};

const bridge = {
  zkInit, zkTerminate, zkGetDeviceCount, zkOpenDevice, zkCloseDevice,
  zkInitDB, zkCapture, zkIdentify, zkLoadTemplates, zkAddTemplate,
  zkClearDB, zkGetCount, zkRemoveTemplate,
  isDeviceOpen, isDBReady,
};

export default bridge;
