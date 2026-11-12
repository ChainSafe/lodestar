import type {Stream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {byteStream} from "@libp2p/utils";
import {ForkName} from "@lodestar/params";
import {readEncodedPayload} from "../encodingStrategies/index.js";
import {RespStatus} from "../interface.js";
import {ResponseError} from "../response/index.js";
import {
  CONTEXT_BYTES_FORK_DIGEST_LENGTH,
  ContextBytesFactory,
  ContextBytesType,
  MixedProtocol,
  ResponseIncoming,
} from "../types.js";
import {decodeErrorMessage, drainByteStream} from "../utils/index.js";

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
export async function* responseDecode(
  protocol: MixedProtocol,
  stream: Stream,
  opts: {signal?: AbortSignal; getError?: () => Error} = {}
): AsyncIterable<ResponseIncoming> {
  const bytes = byteStream(stream);
  let responseReadDone = false;

  try {
    while (true) {
      const status = await readResultHeader(bytes, opts.signal);

      // Stream is only allowed to end at the start of a <response_chunk> block
      // The happens when source ends before readResultHeader() can fetch 1 byte
      if (status === StreamStatus.Ended) {
        break;
      }

      // For multiple chunks, only the last chunk is allowed to have a non-zero error
      // code (i.e. The chunk stream is terminated once an error occurs
      if (status !== RespStatus.SUCCESS) {
        const errorMessage = await readErrorMessage(bytes, opts.signal);
        throw new ResponseError(status, errorMessage);
      }

      const forkName = await readContextBytes(protocol.contextBytes, bytes, opts.signal);
      const typeSizes = protocol.responseSizes(forkName);
      const chunkData = await readEncodedPayload(bytes, protocol.encoding, typeSizes, opts.signal);

      yield {
        data: chunkData,
        fork: forkName,
        protocolVersion: protocol.version,
      };
    }
    responseReadDone = true;
  } catch (e) {
    if (opts.signal?.aborted && opts.getError) {
      throw opts.getError();
    }
    throw e;
  } finally {
    try {
      if (!responseReadDone) {
        // Do not push partial bytes back into the stream on decode failure/abort.
        // This stream is consumed by req/resp only once.
        drainByteStream(bytes);
      }
      bytes.unwrap();
    } catch {
      // Ignore unwrap errors - stream may already be closed
    }
  }
}

/**
 * Consumes a stream source to read a `<result>`
 * ```bnf
 * result  ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 * `<response_chunk>` starts with a single-byte response code which determines the contents of the response_chunk
 */
export async function readResultHeader(
  bytes: ByteStream<Stream>,
  signal?: AbortSignal
): Promise<RespStatus | StreamStatus> {
  const chunk = await bytes.read({bytes: 1, signal}).catch((e) => {
    if ((e as Error).name === "UnexpectedEOFError") return null;
    throw e;
  });
  if (chunk === null) return StreamStatus.Ended;

  return chunk.get(0);
}

/**
 * Consumes a stream source to read an optional `<error_response>?`
 * ```bnf
 * error_response  ::= <result> | <error_message>?
 * result          ::= "1" | "2" | ["128" ... "255"]
 * ```
 */
export async function readErrorMessage(bytes: ByteStream<Stream>, signal?: AbortSignal): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < 256) {
    const chunk = await bytes.read({signal}).catch((e) => {
      if ((e as Error).name === "UnexpectedEOFError") return null;
      throw e;
    });
    if (chunk === null) {
      // If EOF is reached while satisfying a larger read, libp2p v3 may still have
      // buffered bytes available. Drain them so error_message matches pre-v3 behavior.
      const remaining = drainByteStream(bytes);
      if (remaining) {
        chunks.push(remaining);
      }
      break;
    }
    chunks.push(chunk.subarray());
    total += chunk.byteLength;
  }

  return decodeErrorMessage(Buffer.concat(chunks).subarray(0, 256));
}

/**
 * Consumes a stream source to read a variable length `<context-bytes>` depending on the method.
 * While `<context-bytes>` has a single type of `ForkDigest`, this function only parses the `ForkName`
 * of the `ForkDigest` or defaults to `phase0`
 */
export async function readContextBytes(
  contextBytes: ContextBytesFactory,
  bytes: ByteStream<Stream>,
  signal?: AbortSignal
): Promise<ForkName> {
  switch (contextBytes.type) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    case ContextBytesType.ForkDigest: {
      const forkDigest = await readContextBytesForkDigest(bytes, signal);
      return contextBytes.config.forkDigest2ForkBoundary(forkDigest).fork;
    }
  }
}

/**
 * Consumes a stream source to read `<context-bytes>`, where it's a fixed-width 4 byte
 */
export async function readContextBytesForkDigest(bytes: ByteStream<Stream>, signal?: AbortSignal): Promise<Uint8Array> {
  return (await bytes.read({bytes: CONTEXT_BYTES_FORK_DIGEST_LENGTH, signal})).subarray();
}
