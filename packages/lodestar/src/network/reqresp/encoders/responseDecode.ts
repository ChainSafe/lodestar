import {ForkName} from "@chainsafe/lodestar-params";
import {IForkDigestContext} from "@chainsafe/lodestar-config";
import {RespStatus} from "../../../constants";
import {BufferedSource, decodeErrorMessage} from "../utils";
import {readEncodedPayload} from "../encodingStrategies";
import {ResponseError} from "../response";
import {
  Protocol,
  IncomingResponseBody,
  ContextBytesType,
  deserializeToTreeByMethod,
  contextBytesTypeByProtocol,
  getResponseSzzTypeByMethod,
  CONTEXT_BYTES_FORK_DIGEST_LENGTH,
} from "../types";

/**
 * Internal helper type to signal stream ended early
 */
enum StreamStatus {
  Ended = "STREAM_ENDED",
}

/**
 * Consumes a stream source to read a `<response>`
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <context-bytes> | <encoding-dependent-header> | <encoded-payload>
 * result          ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 */
export function responseDecode(
  forkDigestContext: IForkDigestContext,
  protocol: Protocol
): (source: AsyncIterable<Buffer>) => AsyncGenerator<IncomingResponseBody> {
  return async function* responseDecodeSink(source) {
    const deserializeToTree = deserializeToTreeByMethod[protocol.method];
    const contextBytesType = contextBytesTypeByProtocol(protocol);
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);

    // Consumers of `responseDecode()` may limit the number of <response_chunk> and break out of the while loop
    while (!bufferedSource.isDone) {
      const status = await readResultHeader(bufferedSource);

      // Stream is only allowed to end at the start of a <response_chunk> block
      // The happens when source ends before readResultHeader() can fetch 1 byte
      if (status === StreamStatus.Ended) {
        break;
      }

      // For multiple chunks, only the last chunk is allowed to have a non-zero error
      // code (i.e. The chunk stream is terminated once an error occurs
      if (status !== RespStatus.SUCCESS) {
        const errorMessage = await readErrorMessage(bufferedSource);
        throw new ResponseError(status, errorMessage);
      }

      const forkName = await readForkName(forkDigestContext, bufferedSource, contextBytesType);
      const type = getResponseSzzTypeByMethod(protocol, forkName);

      yield await readEncodedPayload(bufferedSource, protocol.encoding, type, {deserializeToTree});
    }
  };
}

/**
 * Consumes a stream source to read a `<result>`
 * ```bnf
 * result  ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 * `<response_chunk>` starts with a single-byte response code which determines the contents of the response_chunk
 */
export async function readResultHeader(bufferedSource: BufferedSource): Promise<RespStatus | StreamStatus> {
  for await (const buffer of bufferedSource) {
    const status = buffer.get(0);
    buffer.consume(1);

    // If first chunk had zero bytes status === null, get next
    if (status !== null) {
      return status;
    }
  }

  return StreamStatus.Ended;
}

/**
 * Consumes a stream source to read an optional `<error_response>?`
 * ```bnf
 * error_response  ::= <result> | <error_message>?
 * result          ::= "1" | "2" | ["128" ... "255"]
 * ```
 */
export async function readErrorMessage(bufferedSource: BufferedSource): Promise<string> {
  for await (const buffer of bufferedSource) {
    // Wait for next chunk with bytes or for the stream to end
    // Note: The entire <error_message> is expected to be in the same chunk
    if (buffer.length === 0) {
      continue;
    }

    const bytes = buffer.slice();
    try {
      return decodeErrorMessage(bytes);
    } catch {
      return bytes.toString("hex");
    }
  }

  // Error message is optional and may not be included in the response stream
  return "";
}

/**
 * Consumes a stream source to read a variable length `<context-bytes>` depending on the method.
 * While `<context-bytes>` has a single type of `ForkDigest`, this function only parses the `ForkName`
 * of the `ForkDigest` or defaults to `phase0`
 */
export async function readForkName(
  forkDigestContext: IForkDigestContext,
  bufferedSource: BufferedSource,
  contextBytes: ContextBytesType
): Promise<ForkName> {
  switch (contextBytes) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    case ContextBytesType.ForkDigest: {
      const forkDigest = await readContextBytesForkDigest(bufferedSource);
      return forkDigestContext.forkDigest2ForkName(forkDigest);
    }
  }
}

/**
 * Consumes a stream source to read `<context-bytes>`, where it's a fixed-width 4 byte
 */
export async function readContextBytesForkDigest(bufferedSource: BufferedSource): Promise<Buffer> {
  for await (const buffer of bufferedSource) {
    if (buffer.length >= CONTEXT_BYTES_FORK_DIGEST_LENGTH) {
      const bytes = buffer.slice(0, CONTEXT_BYTES_FORK_DIGEST_LENGTH);
      buffer.consume(CONTEXT_BYTES_FORK_DIGEST_LENGTH);
      return bytes;
    }
  }

  // TODO: Use typed error
  throw Error("Source ended while reading context bytes");
}
