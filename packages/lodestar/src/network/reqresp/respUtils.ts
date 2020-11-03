import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {RequestId, ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import pipe from "it-pipe";
import {RpcResponseStatus} from "../../constants";
import {Method, ReqRespEncoding} from "../../constants/network";
import {IResponseChunk} from "../encoders/interface";
import {encodeP2pErrorMessage, eth2ResponseEncode} from "../encoders/response";
import {RpcError} from "../error";

export async function sendResponse(
  modules: {config: IBeaconConfig; logger: ILogger},
  id: RequestId,
  method: Method,
  encoding: ReqRespEncoding,
  sink: Sink<unknown, unknown>,
  err: RpcError | null,
  response?: ResponseBody
): Promise<void> {
  return sendResponseStream(
    modules,
    id,
    method,
    encoding,
    sink,
    err,
    (async function* () {
      if (response != null) {
        yield response;
      }
    })()
  );
}

export async function sendResponseStream(
  modules: {config: IBeaconConfig; logger: ILogger},
  id: RequestId,
  method: Method,
  encoding: ReqRespEncoding,
  sink: Sink<unknown, unknown>,
  err: RpcError | null,
  chunkIter: AsyncIterable<ResponseBody>
): Promise<void> {
  const {logger, config} = modules;
  let respSource: AsyncIterable<IResponseChunk>;
  if (err) {
    respSource = (async function* () {
      yield {
        requestId: id,
        status: err.status,
        body: encodeP2pErrorMessage(config, err.message || ""),
      };
    })();
  } else {
    respSource = (async function* () {
      for await (const chunk of chunkIter) {
        yield {status: RpcResponseStatus.SUCCESS, requestId: id, body: chunk};
      }
    })();
  }
  await pipe(respSource, eth2ResponseEncode(config, logger, method, encoding), sink);
  logger.verbose("Sent reqresp response", {requestId: id, method, encoding, error: err?.message ?? "false"});
}
