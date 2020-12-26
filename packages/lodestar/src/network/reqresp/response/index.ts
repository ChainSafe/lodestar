import PeerId from "peer-id";
import pipe from "it-pipe";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../constants";
import {ILibP2pStream, ReqRespHandler} from "../interface";
import {ReqRespError} from "../errors";
import {requestDecode} from "./requestDecode";
import {responseEncodeError, responseEncodeSuccess} from "./responseEncode";

// The responder MUST:
// 1. Use the encoding strategy to read the optional header.
// 2. If there are any length assertions for length N, it should read
//    exactly N bytes from the stream, at which point an EOF should arise
//    (no more bytes). Error otherwise
// 3. Deserialize the expected type, and process the request. Error otherwise
// 4. Write the response which may consist of zero or more response_chunks
//    (result, optional header, payload).
// 5. Close their write side of the stream. At this point, the stream
//    will be fully closed.

export async function handleRequest(
  config: IBeaconConfig,
  performRequestHandler: ReqRespHandler,
  stream: ILibP2pStream,
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding
): Promise<void> {
  try {
    await pipe(
      handleRequestAsStream(config, performRequestHandler, stream.source, method, encoding, peerId),
      stream.sink
    );
  } catch (e) {
    // TODO: In case sending the error fails
  } finally {
    // TODO: Extra cleanup? Close connection?
    stream.close();
  }
}

/**
 * Yields success chunks and error chunks in the same generator
 * This syntax allows to recycle the same streamSink to send success and error chunks
 * in case request whose body is a List fails at chunk_i > 0, without breaking out of the for..await..of
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
    const requestBody = await pipe(streamSource, requestDecode(config, method, encoding)).catch((e) => {
      throw new ReqRespError(RpcResponseStatus.INVALID_REQUEST, e.message);
    });

    yield* pipe(performRequestHandler(method, requestBody, peerId), responseEncodeSuccess(config, method, encoding));
  } catch (e) {
    const status = e instanceof ReqRespError ? e.status : RpcResponseStatus.SERVER_ERROR;
    yield* responseEncodeError(status, e.message);

    // TODO: Re-throw the error?
  } finally {
    // TODO: Extra cleanup?
  }
}
