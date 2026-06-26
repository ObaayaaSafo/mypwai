import koffi from 'koffi';

const lib = koffi.load('libzkfp.dll');

const init = lib.func('int ZKFPM_Init()');
const term = lib.func('int ZKFPM_Terminate()');
const open = lib.func('void *ZKFPM_OpenDevice(int index)');
const close = lib.func('int ZKFPM_CloseDevice(void *hDevice)');
const getParam = lib.func(
  'int ZKFPM_GetParameters(void *hDevice, int nParamCode, _Out_ uint8_t *paramValue, _Out_ unsigned int *cbParamValue)'
);

init();
const h = open(0);
console.log('Device opened:', h != null);

// Query image dimensions
for (const code of [1, 2, 3, 106]) {
  const val = Buffer.alloc(4);
  const cb = Buffer.alloc(4);
  cb.writeUInt32LE(4, 0);
  
  const ret = getParam(h, code, val, cb);
  const name = {1:'Width',2:'Height',3:'DPI',106:'ImageDataSize'}[code];
  const v = val.readInt32LE(0);
  console.log(`Param ${code} (${name}): ret=${ret}, value=${v}`);
}

close(h);
term();
