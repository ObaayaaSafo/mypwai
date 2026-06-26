// Non-interactive scanner detection test
import koffi from 'koffi';

console.log('=== ZK9500 Scanner Detection ===\n');

const lib = koffi.load('libzkfp.dll');

const ZKFPM_Init = lib.func('int ZKFPM_Init()');
const ZKFPM_Terminate = lib.func('int ZKFPM_Terminate()');
const ZKFPM_GetDeviceCount = lib.func('int ZKFPM_GetDeviceCount()');
const ZKFPM_OpenDevice = lib.func('void *ZKFPM_OpenDevice(int index)');
const ZKFPM_CloseDevice = lib.func('int ZKFPM_CloseDevice(void *hDevice)');
const ZKFPM_DBInit = lib.func('void *ZKFPM_DBInit()');
const ZKFPM_DBFree = lib.func('int ZKFPM_DBFree(void *hDBCache)');

// Init
let r = ZKFPM_Init();
console.log(`ZKFPM_Init: ${r === 0 ? '✓ OK' : '✗ FAILED (' + r + ')'}`);

// Count
const count = ZKFPM_GetDeviceCount();
console.log(`Device count: ${count}`);
if (count === 0) {
  console.log('✗ No ZK scanner detected. Check USB connection and drivers.');
  ZKFPM_Terminate();
  process.exit(1);
}

// Open
const h = ZKFPM_OpenDevice(0);
console.log(`OpenDevice(0): ${h != null ? '✓ OK' : '✗ FAILED'}`);

// DB
const db = ZKFPM_DBInit();
console.log(`DBInit: ${db != null ? '✓ OK' : '✗ FAILED'}`);

// Cleanup
if (db) ZKFPM_DBFree(db);
if (h) ZKFPM_CloseDevice(h);
ZKFPM_Terminate();

console.log('\n✓ Scanner is working. Run `npx tsx test-enroll.ts` to capture a fingerprint.');
