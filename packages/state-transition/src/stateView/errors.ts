import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export enum StateViewErrorCode {
  NATIVE_UNSUPPORTED_FORK = "NATIVE_STF_UNSUPPORTED_FORK",
  BACKEND_MISMATCH = "STATE_VIEW_BACKEND_MISMATCH",
}

type StateViewErrorType =
  | {code: StateViewErrorCode.NATIVE_UNSUPPORTED_FORK; fork: ForkName; slot: Slot}
  | {code: StateViewErrorCode.BACKEND_MISMATCH; native: boolean};

export class StateViewError extends LodestarError<StateViewErrorType> {}

export function assertNativeForkSupported(config: ChainForkConfig, slot: Slot): void {
  if (config.getForkSeq(slot) >= ForkSeq.gloas) {
    throw new StateViewError({code: StateViewErrorCode.NATIVE_UNSUPPORTED_FORK, fork: config.getForkName(slot), slot});
  }
}
