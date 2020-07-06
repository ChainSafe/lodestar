import {ReqRespEncoding} from "../../constants";
import {createCompressStream} from "@chainsafe/snappy-stream";
import {source} from "stream-to-it";
import {IDecompressor} from "./interface";
import {SnappyFramesUncompress} from "./snappy-frames/uncompress";

export function getCompressor(encoding: ReqRespEncoding): (data: Buffer) => AsyncGenerator<Buffer> {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY: {
      return (data) => {
        const stream = createCompressStream();
        stream.write(data);
        stream.end();
        return source<Buffer>(stream);
      };
    }
    case ReqRespEncoding.SSZ:
      return (data => {
        return (async function*() {
          //TODO: split into smaller chunks
          yield data;
        })();
      });
  }
}


export function getDecompressor(encoding: ReqRespEncoding): IDecompressor {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY:
      return new SnappyFramesUncompress();
    case ReqRespEncoding.SSZ:
      return {
        uncompress(chunk: Buffer): Buffer | null {
          return chunk;
        },
        reset(): void {
          //nothing to ignore
        }
      };
  }
}



export function encodeResponseStatus(status: number): Buffer {
  return Buffer.from([status]);
}

export function maxEncodedLen(sszLength: number, encoding: ReqRespEncoding): number {
  if (encoding === ReqRespEncoding.SSZ) {
    return sszLength;
  }
  // worst-case compression result by Snappy
  return 32 + sszLength + sszLength / 6;
}