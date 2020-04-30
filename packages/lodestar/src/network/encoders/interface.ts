import {RpcResponseStatus} from "../../constants";
import {ResponseBody} from "@chainsafe/lodestar-types";

export interface IDecompressor {
  uncompress(chunk: Buffer): Buffer|null;

  reset(): void;
}

export interface IResponseChunk {

  status: RpcResponseStatus;

  //missing body if status !== 0
  body?: ResponseBody;

}