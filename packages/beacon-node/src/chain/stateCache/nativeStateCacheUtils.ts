import {BeaconStateView} from "@lodestar/native";
import {IBeaconStateView, NativeBeaconStateView} from "@lodestar/state-transition";
import {LodestarError} from "@lodestar/utils";

export function getBinding(state: IBeaconStateView): BeaconStateView {
  if (!(state instanceof NativeBeaconStateView)) throw new LodestarError({code: "NATIVE_REGEN_REQUIRES_NATIVE_STATE"});
  return state.binding as BeaconStateView;
}

export function nativeErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
