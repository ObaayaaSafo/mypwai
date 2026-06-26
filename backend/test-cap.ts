import koffi from 'koffi';

const lib = koffi.load('libzkfp.dll');

const init = lib.func('int ZKFPM_Init()');
const term = lib.func('int ZKFPM_Terminate()');
const count = lib.func('int ZKFPM_GetDeviceCount()');
const open = lib.func('void *ZKFPM_OpenDevice(int index)');
const close = lib.func('int ZKFPM_CloseDevice(void *hDevice)');

const capFP = lib.func(
  'int ZKFPM_AcquireFingerprint(void *hDevice, _Out_ uint8_t *fpImage, unsigned int cbFPImage, _Out_ uint8_t *fpTemplate, _Out_ unsigned int *cbTemplate)'
);
const capImg = lib.func(
  'int ZKFPM_AcquireFingerprintImage(void *hDevice, _Out_ uint8_t *fpImage, unsigned int cbFPImage)'
);

init();
const n = count();
console.log('Devices:', n);
const h = open(0);
console.log('Opened:', h != null ? 'yes' : 'no');

await new Promise(r => setTimeout(r, 2000));

// Correct image size for ZK9500: 300x375 = 112500 bytes
const IMG_SIZE = 300 * 375;

console.log('\n--- Test: AcquireFingerprintImage ---');
const img = Buffer.alloc(IMG_SIZE);
const r1 = capImg(h, img, IMG_SIZE);
console.log('Result:', r1);

console.log('\n--- Test: AcquireFingerprint ---');
const img2 = Buffer.alloc(IMG_SIZE);
const tpl = Buffer.alloc(2048);
const cbTpl = Buffer.alloc(4);
cbTpl.writeUInt32LE(2048, 0);
const r2 = capFP(h, img2, IMG_SIZE, tpl, cbTpl);
console.log('Result:', r2);
if (r2 === 0) console.log('Template size:', cbTpl.readUInt32LE(0));

close(h);
term();
console.log('Done.');
