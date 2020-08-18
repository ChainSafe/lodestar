import {RequestId, RpcResponseStatus} from "../../constants";
import {ResponseBody, RequestBody} from "@chainsafe/lodestar-types";

export interface IDecompressor {
  uncompress(chunk: Buffer): Buffer|null;

  reset(): void;
}

export interface IResponseChunk {
  requestId: RequestId;
  status: RpcResponseStatus;
  body: ResponseBody;
}

export interface IValidatedRequestBody {
  isValid: boolean;
  // missing body if isValid=false
  body?: RequestBody;
}
