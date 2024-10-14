import {Uint8ArrayList} from "uint8arraylist";
import {ForkName} from "@lodestar/params";
import {BufferedSource, decodeErrorMessage} from "../utils/index.js";
import {readEncodedPayload} from "../encodingStrategies/index.js";
import {ResponseError} from "../response/index.js";
import {
  ContextBytesType,
  CONTEXT_BYTES_FORK_DIGEST_LENGTH,
  ContextBytesFactory,
  MixedProtocol,
  ResponseIncoming,
} from "../types.js";
import {RespStatus} from "../interface.js";

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
  protocol: MixedProtocol,
  cbs: {
    onFirstHeader: () => void;
    onFirstResponseChunk: () => void;
  }
): (source: AsyncIterable<Uint8Array | Uint8ArrayList>) => AsyncIterable<ResponseIncoming> {
  return async function* responseDecodeSink(source) {
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Uint8ArrayList>);

    let readFirstHeader = false;
    let readFirstResponseChunk = false;

    // Consumers of `responseDecode()` may limit the number of <response_chunk> and break out of the while loop
    while (!bufferedSource.isDone) {
      const status = await readResultHeader(bufferedSource);

      // Stream is only allowed to end at the start of a <response_chunk> block
      // The happens when source ends before readResultHeader() can fetch 1 byte
      if (status === StreamStatus.Ended) {
        break;
      }

      if (!readFirstHeader) {
        cbs.onFirstHeader();
        readFirstHeader = true;
      }

      // For multiple chunks, only the last chunk is allowed to have a non-zero error
      // code (i.e. The chunk stream is terminated once an error occurs
      console.log("bufferedSourceFull", Buffer.from(bufferedSource["buffer"].subarray()).toString("hex"));
      if (status !== RespStatus.SUCCESS) {
        const errorMessage = await readErrorMessage(bufferedSource);
        throw new ResponseError(status, errorMessage);
      }

      const forkName = await readContextBytes(protocol.contextBytes, bufferedSource);
      const typeSizes = protocol.responseSizes(forkName);
      const chunkData = await readEncodedPayload(bufferedSource, protocol.encoding, typeSizes);

      yield {
        data: chunkData,
        fork: forkName,
        protocolVersion: protocol.version,
      };

      if (!readFirstResponseChunk) {
        cbs.onFirstResponseChunk();
        readFirstResponseChunk = true;
      }
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
  // Read at least 256 or wait for the stream to end
  let length: number | undefined;
  for await (const buffer of bufferedSource) {
    // Wait for next chunk with bytes or for the stream to end
    // Note: The entire <error_message> is expected to be in the same chunk
    if (buffer.length >= 256) {
      length = 256;
      break;
    }
    length = buffer.length;
  }

  // biome-ignore lint/complexity/useLiteralKeys: It is a private attribute
  const bytes = bufferedSource["buffer"].slice(0, length);

  try {
    return decodeErrorMessage(bytes);
  } catch (_e) {
    // Error message is optional and may not be included in the response stream
    return Buffer.prototype.toString.call(bytes, "hex");
  }
}

/**
 * Consumes a stream source to read a variable length `<context-bytes>` depending on the method.
 * While `<context-bytes>` has a single type of `ForkDigest`, this function only parses the `ForkName`
 * of the `ForkDigest` or defaults to `phase0`
 */
export async function readContextBytes(
  contextBytes: ContextBytesFactory,
  bufferedSource: BufferedSource
): Promise<ForkName> {
  switch (contextBytes.type) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    case ContextBytesType.ForkDigest: {
      const forkDigest = await readContextBytesForkDigest(bufferedSource);
      console.log("forkDigest", Buffer.from(forkDigest).toString("hex"));
      const ctx = contextBytes.forkDigestContext;
      console.log("knownForkDigests", {
        phase0: ctx.forkName2ForkDigestHex(ForkName.phase0),
        altair: ctx.forkName2ForkDigestHex(ForkName.altair),
        bellatrix: ctx.forkName2ForkDigestHex(ForkName.bellatrix),
        capella: ctx.forkName2ForkDigestHex(ForkName.capella),
        deneb: ctx.forkName2ForkDigestHex(ForkName.deneb),
        electra: ctx.forkName2ForkDigestHex(ForkName.electra),
      });
      return contextBytes.forkDigestContext.forkDigest2ForkName(forkDigest);
    }
  }
}

/**
 * Consumes a stream source to read `<context-bytes>`, where it's a fixed-width 4 byte
 */
export async function readContextBytesForkDigest(bufferedSource: BufferedSource): Promise<Uint8Array> {
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
