// Polling capture test — matches MFC demo's ThreadCapture loop
// The SDK requires continuous polling: AcquireFingerprint → check → Sleep(100) → repeat
import koffi from 'koffi';

console.log('=== ZK9500 Polling Capture ===\n');
console.log('Place your finger on the scanner NOW and keep it there.\n');
console.log('Polling for finger (100ms intervals, max 15s)...\n');

const lib = koffi.load('libzkfp.dll');

const init = lib.func('int ZKFPM_Init()');
const term = lib.func('int ZKFPM_Terminate()');
const open = lib.func('void *ZKFPM_OpenDevice(int index)');
const close = lib.func('int ZKFPM_CloseDevice(void *hDevice)');
const getParam = lib.func(
  'int ZKFPM_GetParameters(void *hDevice, int nParamCode, _Out_ uint8_t *paramValue, _Out_ unsigned int *cbParamValue)'
);
const setParam = lib.func(
  'int ZKFPM_SetParameters(void *hDevice, int nParamCode, _In_ uint8_t *paramValue, unsigned int cbParamValue)'
);
const capFP = lib.func(
  'int ZKFPM_AcquireFingerprint(void *hDevice, _Out_ uint8_t *fpImage, unsigned int cbFPImage, _Out_ uint8_t *fpTemplate, _Out_ unsigned int *cbTemplate)'
);
const dbInit = lib.func('void *ZKFPM_DBInit()');
const dbFree = lib.func('int ZKFPM_DBFree(void *hDBCache)');
const dbAdd = lib.func(
  'int ZKFPM_DBAdd(void *hDBCache, unsigned int fid, _In_ uint8_t *fpTemplate, unsigned int cbTemplate)'
);
const dbIdentify = lib.func(
  'int ZKFPM_DBIdentify(void *hDBCache, _In_ uint8_t *fpTemplate, unsigned int cbTemplate, _Out_ unsigned int *FID, _Out_ unsigned int *score)'
);

// Init
init();
const h = open(0);
if (!h) { console.log('Open failed'); term(); process.exit(1); }

// Query image size (like the demo does)
let imgW = 0, imgH = 0;
for (const [code, name] of [[1, 'W'], [2, 'H']] as const) {
  const val = Buffer.alloc(4);
  const cb = Buffer.alloc(4);
  cb.writeUInt32LE(4, 0);
  getParam(h, code, val, cb);
  const v = cb.readUInt32LE(0) === 4 ? val.readInt32LE(0) : undefined;
  if (code === 1) imgW = v || 300;
  if (code === 2) imgH = v || 375;
}
const IMG_SZ = imgW * imgH;
console.log(`Sensor: ${imgW}x${imgH} = ${IMG_SZ} bytes`);

// Enable anti-fake like the demo
const fakeOn = Buffer.alloc(4);
fakeOn.writeInt32LE(1, 0);
setParam(h, 2002, fakeOn, 4);

// Allocate capture buffer
const pImgBuf = Buffer.alloc(IMG_SZ);

// ── Polling loop (matches MFC demo ThreadCapture) ──
const MAX_ATTEMPTS = 150; // 15s at 100ms
let captured = false;

for (let i = 0; i < MAX_ATTEMPTS; i++) {
  const tpl = Buffer.alloc(2048);
  const cbTpl = Buffer.alloc(4);
  cbTpl.writeUInt32LE(2048, 0);

  const ret = capFP(h, pImgBuf, IMG_SZ, tpl, cbTpl);

  if (ret === 0) {
    const sz = cbTpl.readUInt32LE(0);
    console.log(`\n✓ CAPTURED! Attempt ${i + 1}, template: ${sz} bytes`);
    
    // Enroll
    const db = dbInit();
    if (db) {
      const addRet = dbAdd(db, 1, tpl.subarray(0, sz), sz);
      console.log(`Enrolled: ${addRet === 0 ? 'OK' : 'Error ' + addRet}`);
      
      // Verify: capture again
      console.log('\nNow capture again for verification... keep finger on or replace...');
      for (let j = 0; j < 100; j++) {
        await new Promise(r => setTimeout(r, 100));
        const tpl2 = Buffer.alloc(2048);
        const cbTpl2 = Buffer.alloc(4);
        cbTpl2.writeUInt32LE(2048, 0);
        const r2 = capFP(h, pImgBuf, IMG_SZ, tpl2, cbTpl2);
        if (r2 === 0) {
          const sz2 = cbTpl2.readUInt32LE(0);
          const fid = Buffer.alloc(4);
          const score = Buffer.alloc(4);
          const idRet = dbIdentify(db, tpl2.subarray(0, sz2), sz2, fid, score);
          if (idRet === 0) {
            console.log(`✓ VERIFIED! FID: ${fid.readUInt32LE(0)}, Score: ${score.readUInt32LE(0)}`);
          } else {
            console.log(`No match: ${idRet}`);
          }
          break;
        }
      }
      dbFree(db);
    }
    
    captured = true;
    break;
  }
  
  // Progress indicator every second
  if (i % 10 === 0 && i > 0) {
    process.stdout.write(`.${i / 10}s `);
  }
  
  await new Promise(r => setTimeout(r, 100));
}

if (!captured) {
  console.log('\n✗ No finger detected. Is the scanner LED on? Try running the MFC demo at:');
  console.log('  "C:\\Users\\Ben 10\\Desktop\\ZKFingerSDK_Windows_Standard\\...\\c\\MFC Demo\\libzkfpDemo2\\Debug\\libzkfpDemo.exe"');
}

close(h);
term();
console.log('Done.');
