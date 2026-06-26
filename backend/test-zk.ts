import koffi from 'koffi';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(r => rl.question(q, r));

console.log('=== ZKFinger ZK9500 Test ===\n');

const lib = koffi.load('libzkfp.dll');

// Init
const ZKFPM_Init = lib.func('int ZKFPM_Init()');
const ZKFPM_Terminate = lib.func('int ZKFPM_Terminate()');
const ZKFPM_GetDeviceCount = lib.func('int ZKFPM_GetDeviceCount()');
const ZKFPM_OpenDevice = lib.func('void *ZKFPM_OpenDevice(int index)');
const ZKFPM_CloseDevice = lib.func('int ZKFPM_CloseDevice(void *hDevice)');

// Capture
const ZKFPM_AcquireFingerprint = lib.func(
  'int ZKFPM_AcquireFingerprint(void *hDevice, _Out_ uint8_t *fpImage, unsigned int cbFPImage, _Out_ uint8_t *fpTemplate, _Out_ unsigned int *cbTemplate)'
);

// DB
const ZKFPM_DBInit = lib.func('void *ZKFPM_DBInit()');
const ZKFPM_DBFree = lib.func('int ZKFPM_DBFree(void *hDBCache)');
const ZKFPM_DBAdd = lib.func(
  'int ZKFPM_DBAdd(void *hDBCache, unsigned int fid, _In_ uint8_t *fpTemplate, unsigned int cbTemplate)'
);
const ZKFPM_DBIdentify = lib.func(
  'int ZKFPM_DBIdentify(void *hDBCache, _In_ uint8_t *fpTemplate, unsigned int cbTemplate, _Out_ unsigned int *FID, _Out_ unsigned int *score)'
);
const ZKFPM_DBSetParameter = lib.func(
  'int ZKFPM_DBSetParameter(void *hDBCache, int nParamCode, int paramValue)'
);

// Codec
const ZKFPM_BlobToBase64 = lib.func(
  'int ZKFPM_BlobToBase64(_In_ const uint8_t *src, unsigned int cbSrc, _Out_ char *base64Str, unsigned int cbBase64str)'
);
const ZKFPM_Base64ToBlob = lib.func(
  'int ZKFPM_Base64ToBlob(_In_ const char *src, _Out_ uint8_t *blob, unsigned int cbBlob)'
);

const MAX_TEMPLATE = 2048;
const MAX_IMAGE = 256 * 360;

function capture(hDevice: any): Buffer | null {
  const fpImage = Buffer.alloc(MAX_IMAGE);
  const fpTemplate = Buffer.alloc(MAX_TEMPLATE);
  const cbTemplate = Buffer.alloc(4);
  cbTemplate.writeUInt32LE(MAX_TEMPLATE, 0);

  const ret = ZKFPM_AcquireFingerprint(hDevice, fpImage, MAX_IMAGE, fpTemplate, cbTemplate);
  if (ret !== 0) return null;

  const size = cbTemplate.readUInt32LE(0);
  return fpTemplate.subarray(0, size);
}

function templateToB64(template: Buffer): string {
  const buf = Buffer.alloc(template.length * 2 + 64);
  const len = ZKFPM_BlobToBase64(template, template.length, buf, buf.length);
  return buf.subarray(0, len).toString('ascii');
}

function b64ToTemplate(b64: string): Buffer {
  const buf = Buffer.alloc(MAX_TEMPLATE);
  const len = ZKFPM_Base64ToBlob(b64, buf, buf.length);
  return buf.subarray(0, len);
}

// ── Main ──
try {
  console.log('1. Init SDK');
  let r = ZKFPM_Init();
  console.log(`   ZKFPM_Init = ${r}`);

  console.log('2. Get device count');
  const count = ZKFPM_GetDeviceCount();
  console.log(`   Device count = ${count}`);
  if (count === 0) throw new Error('No fingerprint scanner found');

  console.log('3. Open device 0');
  const hDevice = ZKFPM_OpenDevice(0);
  console.log(`   OpenDevice = ${hDevice ? 'OK' : 'FAILED'}`);
  if (!hDevice) throw new Error('Failed to open device');

  console.log('4. Init algorithm cache');
  const hDB = ZKFPM_DBInit();
  console.log(`   DBInit = ${hDB ? 'OK' : 'FAILED'}`);
  if (!hDB) throw new Error('Failed to init DB cache');
  ZKFPM_DBSetParameter(hDB, 1, 45); // 1:1 threshold
  ZKFPM_DBSetParameter(hDB, 2, 55); // 1:N threshold

  // ── Enroll ──
  console.log('\n── ENROLLMENT ──');
  await ask('Place your finger on the scanner and press ENTER...');

  // Try capture up to 3 times
  let template: Buffer | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Capture attempt ${attempt}...`);
    template = capture(hDevice);
    if (template) {
      console.log(`   Captured! Template size: ${template.length} bytes`);
      break;
    }
    console.log(`   Capture failed (no finger or bad read)`);
    if (attempt < 3) {
      await ask('   Try again - place finger firmly and press ENTER...');
    }
  }

  if (!template) throw new Error('Failed to capture fingerprint after 3 attempts');

  const templateB64 = templateToB64(template);
  console.log(`   Base64 (first 40): ${templateB64.substring(0, 40)}...`);

  // Add to DB with fid=1
  const addRet = ZKFPM_DBAdd(hDB, 1, template, template.length);
  console.log(`   DBAdd(fid=1) = ${addRet === 0 ? 'OK' : 'FAILED:' + addRet}`);

  // ── Verify ──
  console.log('\n── VERIFICATION ──');
  await ask('Now place the SAME finger again and press ENTER...');

  let verifyTemplate: Buffer | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Capture attempt ${attempt}...`);
    verifyTemplate = capture(hDevice);
    if (verifyTemplate) {
      console.log(`   Captured! Template size: ${verifyTemplate.length} bytes`);
      break;
    }
    if (attempt < 3) await ask('   Try again...');
  }

  if (!verifyTemplate) throw new Error('Failed to capture for verification');

  // 1:N identify
  const fid = Buffer.alloc(4);
  const score = Buffer.alloc(4);
  const idRet = ZKFPM_DBIdentify(hDB, verifyTemplate, verifyTemplate.length, fid, score);
  console.log(`   DBIdentify = ${idRet}`);
  if (idRet === 0) {
    console.log(`   Matched FID: ${fid.readUInt32LE(0)}, Score: ${score.readUInt32LE(0)}`);
    console.log(`   ✅ IDENTIFICATION SUCCESS`);
  } else {
    console.log(`   ❌ No match found`);
  }

  // Cleanup
  ZKFPM_DBFree(hDB);
  ZKFPM_CloseDevice(hDevice);
  ZKFPM_Terminate();
  console.log('\n✅ Test complete');

} catch (e: any) {
  console.error('❌ Error:', e.message);
}

rl.close();
