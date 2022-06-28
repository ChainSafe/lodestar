declare module "@chainsafe/snappy-stream" {
  import {Transform} from "node:stream";

  export function createUncompressStream(opts?: {asBuffer?: boolean}): Transform;
  export function createCompressStream(opts?:{asyncCompress?: boolean}): Transform;
}
