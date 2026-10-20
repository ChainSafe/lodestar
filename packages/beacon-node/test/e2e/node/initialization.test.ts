import {afterEach, describe, expect, it, vi} from "vitest";
import * as stateTransition from "@lodestar/state-transition";
import {Network} from "../../../src/network/index.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";

describe("beacon node initialization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("initializes networking with the supplied active validator count without rescanning", async () => {
    const scan = vi.spyOn(stateTransition, "scanActiveValidatorsFromStateBytes");
    const initNetwork = vi.spyOn(Network, "init");
    const node = await getDevBeaconNode({
      params: {},
      validatorCount: 8,
      options: {
        api: {rest: {enabled: false}},
        chain: {
          beaconEngineWorker: false,
          blsVerifyAllMainThread: true,
          disablePrepareNextSlot: true,
        },
        network: {useWorker: false},
        sync: {isSingleNode: true},
      },
    });
    try {
      expect(initNetwork).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({activeValidatorCount: 8}));
      expect(scan).not.toHaveBeenCalled();
    } finally {
      await node.close();
    }
  }, 30_000);
});
