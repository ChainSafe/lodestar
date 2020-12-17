import {RequestId, RpcResponseStatus} from "../../constants";
import {ResponseBody, RequestBody} from "@chainsafe/lodestar-types";

/**
 * For more info about eth2 request/response encoding strategies, see:
 * https://github.com/ethereum/eth2.0-specs/blob/v1.0.0-rc.0/specs/phase0/p2p-interface.md#encoding-strategies
 */
export interface IDecompressor {
  uncompress(chunk: Buffer): Buffer | null;

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
