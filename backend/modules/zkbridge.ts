// Index: zkInit():70 | zkTerminate():78 | zkGetDeviceCount():87 | zkOpenDevice():91 | zkCloseDevice():107
//        zkInitDB():111 | zkCapture():122 | zkAddTemplate():148 | zkIdentify():156 | zkLoadTemplates():168
//        zkClearDB():177 | zkGetCount():181 | zkRemoveTemplate():189 | isDeviceOpen():194 | isDBReady():195
// ponytail: HANDLE = void* on x64; capture = polling loop (non-blocking SDK)
import koffi from 'koffi';

const lib = koffi.load('libzkfp.dll');

// ── Core ──
const ZKFPM_Init = lib.func('int ZKFPM_Init()');
const ZKFPM_Terminate = lib.func('int ZKFPM_Terminate()');

// ── Device (HANDLE = void *) ──
const ZKFPM_GetDeviceCount = lib.func('int ZKFPM_GetDeviceCount()');
const ZKFPM_OpenDevice = lib.func('void *ZKFPM_OpenDevice(int index)');
const ZKFPM_CloseDevice = lib.func('int ZKFPM_CloseDevice(void *hDevice)');

// ── Parameters ──
const ZKFPM_GetParameters = lib.func(
  'int ZKFPM_GetParameters(void *hDevice, int nParamCode, _Out_ uint8_t *paramValue, _Out_ unsigned int *cbParamValue)'
);
const ZKFPM_SetParameters = lib.func(
  'int ZKFPM_SetParameters(void *hDevice, int nParamCode, _In_ uint8_t *paramValue, unsigned int cbParamValue)'
);

// ── Capture ──
const ZKFPM_AcquireFingerprint = lib.func(
  'int ZKFPM_AcquireFingerprint(void *hDevice, _Out_ uint8_t *fpImage, unsigned int cbFPImage, _Out_ uint8_t *fpTemplate, _Out_ unsigned int *cbTemplate)'
);

// ── Algorithm engine ──
const ZKFPM_DBInit = lib.func('void *ZKFPM_DBInit()');
const ZKFPM_DBFree = lib.func('int ZKFPM_DBFree(void *hDBCache)');

// ── DB ops ──
const ZKFPM_DBAdd = lib.func(
  'int ZKFPM_DBAdd(void *hDBCache, unsigned int fid, _In_ uint8_t *fpTemplate, unsigned int cbTemplate)'
);
const ZKFPM_DBDel = lib.func('int ZKFPM_DBDel(void *hDBCache, unsigned int fid)');
const ZKFPM_DBClear = lib.func('int ZKFPM_DBClear(void *hDBCache)');
const ZKFPM_DBCount = lib.func(
  'int ZKFPM_DBCount(void *hDBCache, _Out_ unsigned int *fpCount)'
);
const ZKFPM_DBIdentify = lib.func(
  'int ZKFPM_DBIdentify(void *hDBCache, _In_ uint8_t *fpTemplate, unsigned int cbTemplate, _Out_ unsigned int *FID, _Out_ unsigned int *score)'
);
const ZKFPM_DBSetParameter = lib.func(
  'int ZKFPM_DBSetParameter(void *hDBCache, int nParamCode, int paramValue)'
);

// ── Codec ──
const ZKFPM_BlobToBase64 = lib.func(
  'int ZKFPM_BlobToBase64(_In_ const uint8_t *src, unsigned int cbSrc, _Out_ char *base64Str, unsigned int cbBase64str)'
);
const ZKFPM_Base64ToBlob = lib.func(
  'int ZKFPM_Base64ToBlob(_In_ const char *src, _Out_ uint8_t *blob, unsigned int cbBlob)'
);

// ── State ──
const MAX_TEMPLATE_SIZE = 2048;
let hDevice: any = null;
let hDBCache: any = null;
let imgSize: number = 300 * 375; // default, queried at open
let initialized = false;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function setIntParam(h: any, code: number, value: number): void {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  ZKFPM_SetParameters(h, code, buf, 4);
}

// ── Wrapper API ──

export function zkInit(): number {
  if (initialized) return 0;
  const ret = ZKFPM_Init();
  if (ret === 0) initialized = true;
  return ret;
}

export function zkTerminate(): number {
  if (hDevice) ZKFPM_CloseDevice(hDevice);
  if (hDBCache) ZKFPM_DBFree(hDBCache);
  hDevice = null;
  hDBCache = null;
  initialized = false;
  return ZKFPM_Terminate();
}

export function zkGetDeviceCount(): number {
  return ZKFPM_GetDeviceCount();
}

export function zkOpenDevice(index: number = 0): boolean {
  hDevice = ZKFPM_OpenDevice(index);
  if (!hDevice || hDevice === 0n) return false;

  // Query actual image dimensions
  const val = Buffer.alloc(4);
  const cb = Buffer.alloc(4);
  cb.writeUInt32LE(4, 0);
  if (ZKFPM_GetParameters(hDevice, 1, val, cb) === 0) imgW = val.readInt32LE(0);
  cb.writeUInt32LE(4, 0);
  if (ZKFPM_GetParameters(hDevice, 2, val, cb) === 0) imgH = val.readInt32LE(0);
  imgSize = imgW * imgH;

  // Anti-fake (matches MFC demo)
  setIntParam(hDevice, 2002, 1);

  return true;
}

export function zkCloseDevice(): void {
  if (hDevice) { ZKFPM_CloseDevice(hDevice); hDevice = null; }
}

export function zkInitDB(): boolean {
  hDBCache = ZKFPM_DBInit();
  if (hDBCache == null) return false;
  ZKFPM_DBSetParameter(hDBCache, 1, 45);
  ZKFPM_DBSetParameter(hDBCache, 2, 55);
  return true;
}

/**
 * Capture fingerprint via polling loop (AcquireFingerprint is non-blocking).
 * @param timeoutMs Max time to poll (default 15s)
 * @returns { templateBase64 } or null if timed out
 */
export async function zkCapture(timeoutMs: number = 15000): Promise<{ templateBase64: string } | null> {
  if (!hDevice) throw new Error('No device open');

  const pImg = Buffer.alloc(imgSize);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const tpl = Buffer.alloc(MAX_TEMPLATE_SIZE);
    const cbTpl = Buffer.alloc(4);
    cbTpl.writeUInt32LE(MAX_TEMPLATE_SIZE, 0);

    const ret = ZKFPM_AcquireFingerprint(hDevice, pImg, imgSize, tpl, cbTpl);

    if (ret === 0) {
      const sz = cbTpl.readUInt32LE(0);
      const tplBuf = tpl.subarray(0, sz);

      // Base64 encode
      const b64 = Buffer.alloc(sz * 2 + 64);
      const b64Len = ZKFPM_BlobToBase64(tplBuf, sz, b64, b64.length);
      return { templateBase64: b64Len > 0 ? b64.subarray(0, b64Len).toString('ascii') : '' };
    }

    await sleep(100);
  }

  return null; // timeout
}

export function zkAddTemplate(fid: number, templateBase64: string): boolean {
  if (!hDBCache) throw new Error('DB cache not initialized');
  const blob = Buffer.alloc(MAX_TEMPLATE_SIZE);
  const blobLen = ZKFPM_Base64ToBlob(templateBase64, blob, blob.length);
  if (blobLen <= 0) return false;
  return ZKFPM_DBAdd(hDBCache, fid, blob.subarray(0, blobLen), blobLen) === 0;
}

export function zkIdentify(templateBase64: string): { fid: number; score: number } | null {
  if (!hDBCache) throw new Error('DB cache not initialized');
  const blob = Buffer.alloc(MAX_TEMPLATE_SIZE);
  const blobLen = ZKFPM_Base64ToBlob(templateBase64, blob, blob.length);
  if (blobLen <= 0) return null;

  const fid = Buffer.alloc(4);
  const score = Buffer.alloc(4);
  const ret = ZKFPM_DBIdentify(hDBCache, blob.subarray(0, blobLen), blobLen, fid, score);
  if (ret !== 0) return null;

  return { fid: fid.readUInt32LE(0), score: score.readUInt32LE(0) };
}

export function zkLoadTemplates(templates: Array<{ id: number; template: string }>): number {
  if (!hDBCache) throw new Error('DB cache not initialized');
  let loaded = 0;
  for (const t of templates) {
    if (zkAddTemplate(t.id, t.template)) loaded++;
  }
  return loaded;
}

export function zkClearDB(): void {
  if (hDBCache) ZKFPM_DBClear(hDBCache);
}

export function zkGetCount(): number {
  if (!hDBCache) return 0;
  const count = Buffer.alloc(4);
  const ret = ZKFPM_DBCount(hDBCache, count);
  return ret === 0 ? count.readUInt32LE(0) : 0;
}

export function zkRemoveTemplate(fid: number): boolean {
  if (!hDBCache) return false;
  return ZKFPM_DBDel(hDBCache, fid) === 0;
}

export function isDeviceOpen(): boolean { return hDevice != null; }
export function isDBReady(): boolean { return hDBCache != null; }

// ponytail: module-level, file not needed outside this context
let imgW = 300, imgH = 375;
