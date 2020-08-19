declare module "@chainsafe/snappy-stream" {
  import {Transform} from "stream";

  export function createUncompressStream(opts?: {asBuffer?: boolean}): Transform;
  export function createCompressStream(): Transform;
}
