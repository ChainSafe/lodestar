import {RpcResponseStatus} from "../../../constants";
import {decodeP2pErrorMessage} from "../utils/errorMessage";
import {BufferedSource} from "../utils/bufferedSource";

/**
 * Consumes a stream source to read a <result>
 * ```bnf
 * result  ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 * <response_chunk> start with a single-byte response code which determines the contents of the response_chunk
 */
export async function readResultHeader(bufferedSource: BufferedSource): Promise<RpcResponseStatus> {
  for await (const buffer of bufferedSource) {
    const status = buffer.get(0);
    buffer.consume(1);

    // If first chunk had zero bytes status === null, get next
    if (status !== null) {
      return status;
    }
  }

  throw Error("Stream ended early - result header");
}

export async function readErrorMessage(bufferedSource: BufferedSource): Promise<string> {
  for await (const buffer of bufferedSource) {
    // No bytes left to consume, get next bytes for ErrorMessage
    if (buffer.length === 0) {
      continue;
    }

    const bytes = buffer.slice();
    try {
      return decodeP2pErrorMessage(bytes);
    } catch (e) {
      return bytes.toString("hex");
    }
  }

  // Error message is optional and may not be included in the response stream
  return "";
}
