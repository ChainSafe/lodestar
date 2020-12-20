import {RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {ReqRespEncoding} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {RequestOrResponseType} from "../interface";
import {readSszSnappyChunk, ISszSnappyOptions} from "./sszSnappy/decode";
import {writeChunkSszSnappy} from "./sszSnappy/encode";

// For more info about eth2 request/response encoding strategies, see:
// https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#encoding-strategies

export async function readChunk<T extends ResponseBody | RequestBody>(
  bufferedSource: BufferedSource,
  encoding: ReqRespEncoding,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): Promise<T> {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY:
      return await readSszSnappyChunk(bufferedSource, type, options);

    default:
      throw Error("Unsupported encoding");
  }
}

export async function* writeChunk<T extends ResponseBody | RequestBody>(
  body: T,
  encoding: ReqRespEncoding,
  type: RequestOrResponseType
): AsyncGenerator<Buffer> {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY:
      yield* writeChunkSszSnappy(body, type);
      break;

    default:
      throw Error("Unsupported encoding");
  }
}
