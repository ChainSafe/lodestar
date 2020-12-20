import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RequestId, ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import pipe from "it-pipe";
import {RpcResponseStatus} from "../../constants";
import {Method, ReqRespEncoding} from "../../constants/network";
import {IResponseChunk} from "./interface";
import {responseEncode} from "./encoders/responseEncode";
import {RpcError} from "../error";

export async function sendResponse(
  modules: {config: IBeaconConfig; logger: ILogger},
  requestId: RequestId,
  method: Method,
  encoding: ReqRespEncoding,
  sink: Sink<unknown, unknown>,
  err: RpcError | null,
  response?: ResponseBody
): Promise<void> {
  async function* chunkIter(): AsyncGenerator<ResponseBody> {
    if (response != null) {
      yield response;
    }
  }

  return sendResponseStream(modules, requestId, method, encoding, sink, err, chunkIter());
}

export async function sendResponseStream(
  modules: {config: IBeaconConfig; logger: ILogger},
  requestId: RequestId,
  method: Method,
  encoding: ReqRespEncoding,
  sink: Sink<unknown, unknown>,
  err: RpcError | null,
  chunkIter: AsyncIterable<ResponseBody>
): Promise<void> {
  const {logger, config} = modules;

  async function* respSource(): AsyncIterable<IResponseChunk> {
    if (err) {
      yield {
        status: err.status,
        errorMessage: err.message || "",
      };
    } else {
      for await (const chunk of chunkIter) {
        yield {status: RpcResponseStatus.SUCCESS, body: chunk};
      }
    }
  }

  await pipe(respSource(), responseEncode(config, method, encoding), sink);
  logger.verbose("Sent reqresp response", {requestId, method, encoding, error: err?.message ?? "false"});
}
