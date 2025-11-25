const WORD_MASK = [0, 0xff, 0xffff, 0xffffff, 0xffffffff];
function copyBytes(fromArray: Uint8Array, fromPos: number, toArray: Uint8Array, toPos: number, length: number): void {
  for (let i = 0; i < length; i++) {
    toArray[toPos + i] = fromArray[fromPos + i];
  }
}

function selfCopyBytes(array: Uint8Array, pos: number, offset: number, length: number): void {
  for (let i = 0; i < length; i++) {
    array[pos + i] = array[pos - offset + i];
  }
}

export class SnappyDecompressor {
  private pos = 0;
  constructor(private readonly array: Uint8Array) {}

  readUncompressedLength(): number {
    let result = 0;
    let shift = 0;
    let c: number;
    let val: number;

    while (shift < 32 && this.pos < this.array.length) {
      c = this.array[this.pos];
      this.pos += 1;
      val = c & 0x7f;
      if ((val << shift) >>> shift !== val) {
        return -1;
      }
      result |= val << shift;
      if (c < 128) {
        return result;
      }
      shift += 7;
    }
    return -1;
  }

  uncompressToBuffer(outBuffer: Uint8Array): boolean {
    const array = this.array;
    const arrayLength = array.length;
    let pos = this.pos;
    let outPos = 0;

    let c: number;
    let len = 0;
    let smallLen: number;
    let offset = 0;

    while (pos < array.length) {
      c = array[pos];
      pos += 1;
      if ((c & 0x3) === 0) {
        // Literal
        len = (c >>> 2) + 1;
        if (len > 60) {
          if (pos + 3 >= arrayLength) {
            return false;
          }
          smallLen = len - 60;
          len = array[pos] + (array[pos + 1] << 8) + (array[pos + 2] << 16) + (array[pos + 3] << 24);
          len = (len & WORD_MASK[smallLen]) + 1;
          pos += smallLen;
        }
        if (pos + len > arrayLength) {
          return false;
        }
        copyBytes(array, pos, outBuffer, outPos, len);
        pos += len;
        outPos += len;
      } else {
        switch (c & 0x3) {
          case 1:
            len = ((c >>> 2) & 0x7) + 4;
            offset = array[pos] + ((c >>> 5) << 8);
            pos += 1;
            break;
          case 2:
            if (pos + 1 >= arrayLength) {
              return false;
            }
            len = (c >>> 2) + 1;
            offset = array[pos] + (array[pos + 1] << 8);
            pos += 2;
            break;
          case 3:
            if (pos + 3 >= arrayLength) {
              return false;
            }
            len = (c >>> 2) + 1;
            offset = array[pos] + (array[pos + 1] << 8) + (array[pos + 2] << 16) + (array[pos + 3] << 24);
            pos += 4;
            break;
          default:
            break;
        }
        if (offset === 0 || offset > outPos) {
          return false;
        }
        selfCopyBytes(outBuffer, outPos, offset, len);
        outPos += len;
      }
    }
    return true;
  }
}
