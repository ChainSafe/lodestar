import {RpcResponseStatus} from "../../../constants";
import {decodeErrorMessage} from "../utils/errorMessage";
import {BufferedSource} from "../utils/bufferedSource";
import {ResponseInternalError, ResponseErrorCode} from "./errors";

/**
 * Consumes a stream source to read a `<result>`
 * ```bnf
 * result  ::= "0" | "1" | "2" | ["128" ... "255"]
 * ```
 * `<response_chunk>` starts with a single-byte response code which determines the contents of the response_chunk
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

  throw new ResponseInternalError({code: ResponseErrorCode.ENDED_ON_RESULT});
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
    } catch (e) {
      return bytes.toString("hex");
    }
  }

  // Error message is optional and may not be included in the response stream
  return "";
}
