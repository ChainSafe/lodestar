import type {MessageStream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {Uint8ArrayList} from "uint8arraylist";
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
 * Error messages may be either:
 * 1. SSZ-snappy encoded: <varint-length> | <snappy-frames(error-message)>
 * 2. Raw UTF-8 bytes (for compatibility)
 *
 * The decodeErrorMessage utility handles both formats.
 */
async function readErrorMessage(bytes: ByteStream<MessageStream>, signal?: AbortSignal): Promise<string> {
  try {
    // Read error message bytes from stream
    // Error messages are max 256 bytes uncompressed, but may be larger when snappy-encoded
    // Read in chunks until stream ends or we hit a reasonable limit
    const errorBytes = new Uint8ArrayList();
    const maxBytes = 1024; // Reasonable limit for encoded error message

    while (errorBytes.length < maxBytes) {
      try {
        // Read one byte at a time to avoid over-reading
        const chunk = await bytes.read({bytes: 1, signal});
        errorBytes.append(chunk);
      } catch {
        // Stream ended - this is expected
        break;
      }
    }

    if (errorBytes.length === 0) {
      return "";
    }

    // decodeErrorMessage handles both snappy-encoded and raw formats
    return decodeErrorMessage(errorBytes.subarray());
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
