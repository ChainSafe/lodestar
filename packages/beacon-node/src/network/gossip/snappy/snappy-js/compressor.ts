const BLOCK_LOG = 16;
const BLOCK_SIZE = 1 << BLOCK_LOG;

const MAX_HASH_TABLE_BITS = 14;
const globalHashTables = new Array(MAX_HASH_TABLE_BITS + 1);

export class SnappyCompressor {
  constructor(private readonly array: Uint8Array) {}

  maxCompressedLength(): number {
    const sourceLen = this.array.length;
    return 32 + sourceLen + Math.floor(sourceLen / 6);
  }

  compressToBuffer(outBuffer: Uint8Array): number {
    const array = this.array;
    const length = array.length;
    let pos = 0;
    let outPos = 0;

    let fragmentSize: number;

    outPos = putVarint(length, outBuffer, outPos);
    while (pos < length) {
      fragmentSize = Math.min(length - pos, BLOCK_SIZE);
      outPos = compressFragment(array, pos, fragmentSize, outBuffer, outPos);
      pos += fragmentSize;
    }

    return outPos;
  }
}

function hashFunc(key: number, hashFuncShift: number): number {
  return (key * 0x1e35a7bd) >>> hashFuncShift;
}

function load32(array: Uint8Array, pos: number): number {
  return array[pos] + (array[pos + 1] << 8) + (array[pos + 2] << 16) + (array[pos + 3] << 24);
}

function equals32(array: Uint8Array, pos1: number, pos2: number): boolean {
  return (
    array[pos1] === array[pos2] &&
    array[pos1 + 1] === array[pos2 + 1] &&
    array[pos1 + 2] === array[pos2 + 2] &&
    array[pos1 + 3] === array[pos2 + 3]
  );
}

function copyBytes(fromArray: Uint8Array, fromPos: number, toArray: Uint8Array, toPos: number, length: number): void {
  for (let i = 0; i < length; i++) {
    toArray[toPos + i] = fromArray[fromPos + i];
  }
}

function emitLiteral(input: Uint8Array, ip: number, len: number, output: Uint8Array, op: number): number {
  if (len <= 60) {
    output[op] = (len - 1) << 2;
    op += 1;
  } else if (len < 256) {
    output[op] = 60 << 2;
    output[op + 1] = len - 1;
    op += 2;
  } else {
    output[op] = 61 << 2;
    output[op + 1] = (len - 1) & 0xff;
    output[op + 2] = (len - 1) >>> 8;
    op += 3;
  }
  copyBytes(input, ip, output, op, len);
  return op + len;
}

function emitCopyLessThan64(output: Uint8Array, op: number, offset: number, len: number): number {
  if (len < 12 && offset < 2048) {
    output[op] = 1 + ((len - 4) << 2) + ((offset >>> 8) << 5);
    output[op + 1] = offset & 0xff;
    return op + 2;
  }
  output[op] = 2 + ((len - 1) << 2);
  output[op + 1] = offset & 0xff;
  output[op + 2] = offset >>> 8;
  return op + 3;
}

function emitCopy(output: Uint8Array, op: number, offset: number, len: number): number {
  while (len >= 68) {
    op = emitCopyLessThan64(output, op, offset, 64);
    len -= 64;
  }
  if (len > 64) {
    op = emitCopyLessThan64(output, op, offset, 60);
    len -= 60;
  }
  return emitCopyLessThan64(output, op, offset, len);
}

function compressFragment(input: Uint8Array, ip: number, inputSize: number, output: Uint8Array, op: number): number {
  let hashTableBits = 1;
  while (1 << hashTableBits <= inputSize && hashTableBits <= MAX_HASH_TABLE_BITS) {
    hashTableBits += 1;
  }
  hashTableBits -= 1;
  const hashFuncShift = 32 - hashTableBits;

  if (typeof globalHashTables[hashTableBits] === "undefined") {
    globalHashTables[hashTableBits] = new Uint16Array(1 << hashTableBits);
  }
  const hashTable = globalHashTables[hashTableBits];
  for (let i = 0; i < hashTable.length; i++) {
    hashTable[i] = 0;
  }

  const ipEnd = ip + inputSize;
  let ipLimit: number;
  const baseIp = ip;
  let nextEmit = ip;

  let hash: number;
  let nextHash: number;
  let nextIp: number;
  let candidate = 0;
  let skip: number;
  let bytesBetweenHashLookups: number;
  let base: number;
  let matched: number;
  let offset: number;
  let prevHash: number;
  let curHash: number;
  let flag = true;

  const INPUT_MARGIN = 15;
  if (inputSize >= INPUT_MARGIN) {
    ipLimit = ipEnd - INPUT_MARGIN;

    ip += 1;
    nextHash = hashFunc(load32(input, ip), hashFuncShift);

    while (flag) {
      skip = 32;
      nextIp = ip;
      do {
        ip = nextIp;
        hash = nextHash;
        bytesBetweenHashLookups = skip >>> 5;
        skip += 1;
        nextIp = ip + bytesBetweenHashLookups;
        if (ip > ipLimit) {
          flag = false;
          break;
        }
        nextHash = hashFunc(load32(input, nextIp), hashFuncShift);
        candidate = baseIp + hashTable[hash];
        hashTable[hash] = ip - baseIp;
      } while (!equals32(input, ip, candidate));

      if (!flag) {
        break;
      }

      op = emitLiteral(input, nextEmit, ip - nextEmit, output, op);

      do {
        base = ip;
        matched = 4;
        while (ip + matched < ipEnd && input[ip + matched] === input[candidate + matched]) {
          matched += 1;
        }
        ip += matched;
        offset = base - candidate;
        op = emitCopy(output, op, offset, matched);

        nextEmit = ip;
        if (ip >= ipLimit) {
          flag = false;
          break;
        }
        prevHash = hashFunc(load32(input, ip - 1), hashFuncShift);
        hashTable[prevHash] = ip - 1 - baseIp;
        curHash = hashFunc(load32(input, ip), hashFuncShift);
        candidate = baseIp + hashTable[curHash];
        hashTable[curHash] = ip - baseIp;
      } while (equals32(input, ip, candidate));

      if (!flag) {
        break;
      }

      ip += 1;
      nextHash = hashFunc(load32(input, ip), hashFuncShift);
    }
  }

  if (nextEmit < ipEnd) {
    op = emitLiteral(input, nextEmit, ipEnd - nextEmit, output, op);
  }

  return op;
}

function putVarint(value: number, output: Uint8Array, op: number): number {
  do {
    output[op] = value & 0x7f;
    value = value >>> 7;
    if (value > 0) {
      output[op] += 0x80;
    }
    op += 1;
  } while (value > 0);
  return op;
}
