import {Epoch, Root} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum InterchangeErrorErrorCode {
  UNSUPPORTED_FORMAT = "ERR_INTERCHANGE_UNSUPPORTED_FORMAT",
  UNSUPPORTED_VERSION = "ERR_INTERCHANGE_UNSUPPORTED_VERSION",
  GENESIS_VALIDATOR_MISMATCH = "ERR_INTERCHANGE_GENESIS_VALIDATOR_MISMATCH",
  INVALID_VALUE = "ERR_INTERCHANGE_INVALID_VALUE",
  FUTURE_TARGET_EPOCH = "ERR_INTERCHANGE_FUTURE_TARGET_EPOCH",
}

type InterchangeErrorErrorType =
  | {code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT; format: string}
  | {code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION; version: string}
  | {code: InterchangeErrorErrorCode.GENESIS_VALIDATOR_MISMATCH; root: Root; expectedRoot: Root}
  | {code: InterchangeErrorErrorCode.INVALID_VALUE; value: string}
  | {code: InterchangeErrorErrorCode.FUTURE_TARGET_EPOCH; targetEpoch: Epoch; currentEpoch: Epoch};

export class InterchangeError extends LodestarError<InterchangeErrorErrorType> {}
