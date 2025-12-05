export interface ISnappyDecompressor {
  readUncompressedLength(): number;
  uncompressInto(outBuffer: Uint8Array): boolean;
}
