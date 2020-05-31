import {RequestId, RpcResponseStatus} from "../../constants";
import {ResponseBody} from "@chainsafe/lodestar-types";

export interface IDecompressor {
  uncompress(chunk: Buffer): Buffer|null;

  reset(): void;
}

export interface IResponseChunk {

  status: RpcResponseStatus;

  requestId: RequestId;

  //missing body if status !== 0
  body?: ResponseBody;

}
