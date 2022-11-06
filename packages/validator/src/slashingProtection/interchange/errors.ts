import {Root} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum InterchangeErrorErrorCode {
  UNSUPPORTED_FORMAT = "ERR_INTERCHANGE_UNSUPPORTED_FORMAT",
  UNSUPPORTED_VERSION = "ERR_INTERCHANGE_UNSUPPORTED_VERSION",
  GENESIS_VALIDATOR_MISMATCH = "ERR_INTERCHANGE_GENESIS_VALIDATOR_MISMATCH",
}

type InterchangeErrorErrorType =
  | {code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT; format: string}
  | {code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION; version: string}
  | {code: InterchangeErrorErrorCode.GENESIS_VALIDATOR_MISMATCH; root: Root; expectedRoot: Root};

export class InterchangeError extends LodestarError<InterchangeErrorErrorType> {
  constructor(type: InterchangeErrorErrorType) {
    super(type);
  }
}
