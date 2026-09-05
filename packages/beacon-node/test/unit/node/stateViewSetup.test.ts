import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {
  BeaconStateView,
  IBeaconStateViewNative,
  NativeBeaconStateView,
  StateViewErrorCode,
} from "@lodestar/state-transition";
import {BeaconNode, BeaconNodeInitModules} from "../../../src/node/nodejs.js";
import {defaultOptions} from "../../../src/node/options.js";
import {generateCachedState} from "../../utils/state.js";

describe("BeaconNode state view setup", () => {
  it.each([false, true])(
    "rejects an anchor from the other implementation before starting services, native=%s",
    async (native) => {
      const config = createBeaconConfig(getConfig(ForkName.phase0), new Uint8Array(32));
      const anchorState = native
        ? new BeaconStateView(generateCachedState())
        : new NativeBeaconStateView({slot: 0} as IBeaconStateViewNative, config);
      // The backend check must reject this setup before any service dependencies are needed.
      const modules = {
        opts: {...defaultOptions, chain: {...defaultOptions.chain, nativeStateView: native}},
        anchorState,
      } as unknown as BeaconNodeInitModules;
      await expect(BeaconNode.init(modules)).rejects.toMatchObject({
        type: {code: StateViewErrorCode.BACKEND_MISMATCH, native},
      });
    }
  );
});
