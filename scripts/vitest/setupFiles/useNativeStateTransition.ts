import {setUseNativeStateTransition} from "@lodestar/state-transition";

if (process.env.LODESTAR_NATIVE_STF === "true") {
  setUseNativeStateTransition(true);
}
