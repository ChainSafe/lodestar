import {LodestarError} from "@chainsafe/lodestar-utils";
import {RpcResponseStatus} from "../../../constants";
import {decodeP2pErrorMessage} from "../utils/errorMessage";
import {BufferedSource} from "../utils/bufferedSource";

// request         ::= <encoding-dependent-header> | <encoded-payload>
// response        ::= <response_chunk>*
// response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
// result          ::= “0” | “1” | “2” | [“128” ... ”255”]

// `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list

export async function readResultHeader(bufferedSource: BufferedSource): Promise<RpcResponseStatus.SUCCESS> {
  for await (const buffer of bufferedSource) {
    const status = buffer.get(0);
    buffer.consume(1);

    // If first chunk had zero bytes status === null, get next
    if (status === null) {
      continue;
    }

    // For multiple chunks, only the last chunk is allowed to have a non-zero error
    // code (i.e. The chunk stream is terminated once an error occurs
    if (status === RpcResponseStatus.SUCCESS) {
      return RpcResponseStatus.SUCCESS;
    }

    // No bytes left to consume, get next bytes for ErrorMessage
    if (buffer.length === 0) {
      continue;
    }

    try {
      const errorMessage = decodeP2pErrorMessage(buffer.slice());
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS, status, errorMessage});
    } catch (e) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR, status, error: e});
    }
  }

  throw Error("Stream ended early");
}

export enum ResponseDecodeErrorCode {
  /** Response had no status SUCCESS and error message was successfully decoded */
  FAILED_DECODE_ERROR = "RESPONSE_DECODE_ERROR_FAILED_DECODE_ERROR",
  /** Response had no status SUCCESS and error message was successfully decoded */
  RECEIVED_ERROR_STATUS = "RESPONSE_DECODE_ERROR_RECEIVED_STATUS",
}

type ResponseDecodeErrorType =
  | {code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR; status: number; error: Error}
  | {code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS; status: number; errorMessage: string};

export class ResponseDecodeError extends LodestarError<ResponseDecodeErrorType> {
  constructor(type: ResponseDecodeErrorType) {
    super(type);
  }
}
