import snappyWasm from "@chainsafe/snappy-wasm";
import {ISnappyDecompressor} from "./interface.js";

// create singleton snappy encoder + decoder
const decoder = new snappyWasm.Decoder();

export class SnappyWasmDecompressor implements ISnappyDecompressor {
  constructor(private readonly data: Uint8Array) {}

  readUncompressedLength(): number {
    try {
      return snappyWasm.decompress_len(this.data);
    } catch {
      return -1;
    }
  }

  uncompressInto(outBuffer: Uint8Array): boolean {
    try {
      decoder.decompress_into(this.data, outBuffer);
      return true;
    } catch {
      return false;
    }
  }
}
