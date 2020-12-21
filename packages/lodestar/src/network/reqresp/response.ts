import PeerId from "peer-id";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../constants";
import {requestDecode} from "./encoders/requestDecode";
import {responseEncodeError, responseEncodeSuccess} from "./encoders/responseEncode";
import {ILibP2pStream, ReqRespHandler} from "./interface";

class InvalidRequestError extends Error {}

export async function handleRequest(
  config: IBeaconConfig,
  performRequestHandler: ReqRespHandler,
  stream: ILibP2pStream,
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding
): Promise<void> {
  try {
    const responseSource = handleRequestAsStream(
      config,
      performRequestHandler,
      stream.source,
      method,
      encoding,
      peerId
    );
    await stream.sink(responseSource);
  } catch (e) {
    // TODO: In case sending the error fails
  } finally {
    // TODO: Extra cleanup? Close connection?
  }
}

/**
 * Yields success chunks and error chunks in the same generator
 * This syntax allows to recycle the same streamSink to send success and error chunks
 * in case request whose body is a List fails at chunk_i > 0
 */
async function* handleRequestAsStream(
  config: IBeaconConfig,
  performRequestHandler: ReqRespHandler,
  streamSource: AsyncIterable<Buffer>,
  method: Method,
  encoding: ReqRespEncoding,
  peerId: PeerId
): AsyncGenerator<Buffer, void, undefined> {
  try {
    const requestDecodeSink = requestDecode(config, method, encoding);
    const requestBody = await requestDecodeSink(streamSource).catch((e) => {
      throw new InvalidRequestError(e.message);
    });

    const responseBodySource = performRequestHandler(method, requestBody, peerId);
    yield* responseEncodeSuccess(config, method, encoding)(responseBodySource);
  } catch (e) {
    const status =
      e instanceof InvalidRequestError ? RpcResponseStatus.INVALID_REQUEST : RpcResponseStatus.SERVER_ERROR;
    yield* responseEncodeError(status, e.message);

    // TODO: Re-throw the error?
  } finally {
    // TODO: Extra cleanup?
  }
}
