import {
  NativeApplicationConfig,
  NativeNetworkApplicationRuntime,
  initializeNativeNetworkRuntime,
} from "@chainsafe/lodestar-z/network";
import {NativeDrain} from "../../src/network/core/native/drain.js";

/** A runtime whose host drain only settles results, as the core's drain does after close. */
export function initializeSettlingRuntime(application: NativeApplicationConfig): NativeNetworkApplicationRuntime {
  let drain: NativeDrain | undefined;
  const runtime = initializeNativeNetworkRuntime(application, () => drain?.request());
  drain = new NativeDrain(
    runtime,
    {budgetMs: 8, peers: 32, settle: 32, servingStarts: 8, gossipItems: 16, gossipBytes: 2 * 1024 * 1024},
    () => null,
    () => false,
    null
  );
  return runtime;
}
