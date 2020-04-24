import {Method} from "../../constants";
import {RequestBody} from "@chainsafe/lodestar-types";

export interface IEth2Encoder {
  decodeRequest(method: Method): (source: AsyncIterable<Buffer>) => AsyncGenerator<RequestBody|null>;
}

export interface IDecompressor {
  uncompress(chunk: Buffer): Buffer|null;
}