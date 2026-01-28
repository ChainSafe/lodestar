import type {MessageStream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {ForkName} from "@lodestar/params";
import {decodePayload} from "../encodingStrategies/index.js";
import {RespStatus} from "../interface.js";
import {ResponseError} from "../response/index.js";
import {
  CONTEXT_BYTES_FORK_DIGEST_LENGTH,
  ContextBytesFactory,
  ContextBytesType,
  MixedProtocol,
  ResponseIncoming,
} from "../types.js";
import {decodeErrorMessage} from "../utils/index.js";

/**
 * Reads and decodes response chunks from a stream using byteStream.
 * Wire format:
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <context-bytes> | <varint-length> | <snappy-frames(ssz-payload)>
 * result          ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 * Yields decoded ResponseIncoming for each successful response chunk.
 * Throws ResponseError for error responses.
 */
export async function* decodeResponse(
  bytes: ByteStream<MessageStream>,
  protocol: MixedProtocol,
  signal?: AbortSignal
): AsyncGenerator<ResponseIncoming> {
  // Read response chunks until stream ends
  while (true) {
    // Try to read the result byte
    const statusResult = await readResultByte(bytes, signal);

    // Stream ended cleanly at chunk boundary
    if (statusResult === null) {
      break;
    }

    // For multiple chunks, only the last chunk is allowed to have a non-zero error
    // code (i.e. The chunk stream is terminated once an error occurs)
    if (statusResult !== RespStatus.SUCCESS) {
      const errorMessage = await readErrorMessage(bytes, signal);
      throw new ResponseError(statusResult, errorMessage);
    }

    const forkName = await readContextBytes(protocol.contextBytes, bytes, signal);
    const typeSizes = protocol.responseSizes(forkName);
    const chunkData = await decodePayload(bytes, protocol.encoding, typeSizes, signal);

    yield {
      data: chunkData,
      fork: forkName,
      protocolVersion: protocol.version,
    };
  }
}

/**
 * Reads a single result byte from the stream.
 * Returns null if stream has ended cleanly.
 */
async function readResultByte(bytes: ByteStream<MessageStream>, signal?: AbortSignal): Promise<RespStatus | null> {
  try {
    const result = await bytes.read({bytes: 1, signal});
    if (result.length === 0) {
      return null;
    }
    return result.get(0) as RespStatus;
  } catch (e) {
    // Stream closed - this is expected at the end of responses
    if ((e as Error).message?.includes("closed") || (e as Error).message?.includes("ended")) {
      return null;
    }
    throw e;
  }
}

/**
 * Reads an optional error message from the stream.
 */
async function readErrorMessage(bytes: ByteStream<MessageStream>, signal?: AbortSignal): Promise<string> {
  try {
    // Read up to 256 bytes for error message
    // Note: The entire <error_message> is expected to be available
    const data = await bytes.read({bytes: 256, signal});

    try {
      return decodeErrorMessage(data.subarray());
    } catch {
      // Error message is optional and may not be decodable
      return Buffer.prototype.toString.call(data.subarray(), "hex");
    }
  } catch {
    // Stream may end without error message
    return "";
  }
}

/**
 * Reads context bytes based on protocol configuration.
 * Returns the ForkName decoded from context bytes, or phase0 if empty.
 */
async function readContextBytes(
  contextBytes: ContextBytesFactory,
  bytes: ByteStream<MessageStream>,
  signal?: AbortSignal
): Promise<ForkName> {
  switch (contextBytes.type) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    case ContextBytesType.ForkDigest: {
      const forkDigest = await bytes.read({bytes: CONTEXT_BYTES_FORK_DIGEST_LENGTH, signal});
      return contextBytes.config.forkDigest2ForkBoundary(forkDigest.subarray()).fork;
    }
  }
}
