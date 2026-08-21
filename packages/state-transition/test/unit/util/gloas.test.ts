import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, MIN_DEPOSIT_AMOUNT, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState} from "../../../src/index.js";
import {CachedBeaconStateGloas} from "../../../src/types.js";
import {
  addBuilderToRegistry,
  appendBuilderToRegistry,
  getExpectedGasLimit,
  isGasLimitTargetCompatible,
} from "../../../src/util/gloas.js";

function buildGloasState(slot = 0): CachedBeaconStateGloas {
  const config = getConfig(ForkName.gloas);
  const view = ssz.gloas.BeaconState.defaultViewDU();
  view.slot = slot;
  view.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.GENESIS_FORK_VERSION,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: 0,
  });
  return createCachedBeaconState(
    view,
    {
      config: createBeaconConfig(config, view.genesisValidatorsRoot),
      pubkeyCache,
    },
    {skipSyncCommitteeCache: true}
  ) as CachedBeaconStateGloas;
}

describe("util / gloas", () => {
  describe("getExpectedGasLimit", () => {
    const testCases: {
      name: string;
      parentGasLimit: number;
      targetGasLimit: number;
      expected: number;
    }[] = [
      {
        name: "Increase within limit",
        parentGasLimit: 30000000,
        targetGasLimit: 30000100,
        expected: 30000100,
      },
      {
        name: "Increase exceeding limit",
        parentGasLimit: 30000000,
        targetGasLimit: 36000000,
        expected: 30029295, // maxGasLimitDifference = (30000000 / 1024) - 1 = 29295
      },
      {
        name: "Decrease within limit",
        parentGasLimit: 30000000,
        targetGasLimit: 29999990,
        expected: 29999990,
      },
      {
        name: "Decrease exceeding limit",
        parentGasLimit: 36000000,
        targetGasLimit: 30000000,
        expected: 35964845, // maxGasLimitDifference = (36000000 / 1024) - 1 = 35155
      },
      {
        name: "Target equals parent",
        parentGasLimit: 30000000,
        targetGasLimit: 30000000,
        expected: 30000000, // No change
      },
      {
        name: "Very small parent gas limit",
        parentGasLimit: 1025,
        targetGasLimit: 2000,
        expected: 1025,
      },
      {
        name: "Target far below parent but limited",
        parentGasLimit: 30000000,
        targetGasLimit: 10000000,
        expected: 29970705, // maxGasLimitDifference = (30000000 / 1024) - 1 = 29295
      },
      {
        name: "Parent gas limit underflows",
        parentGasLimit: 1023,
        targetGasLimit: 30000000,
        expected: 1023,
      },
    ];

    it.each(testCases)("$name", ({parentGasLimit, targetGasLimit, expected}) => {
      expect(getExpectedGasLimit(parentGasLimit, targetGasLimit)).toBe(expected);
    });
  });

  describe("isGasLimitTargetCompatible", () => {
    it("compares bigint gas limits without rounding above Number.MAX_SAFE_INTEGER", () => {
      const parentGasLimit = 9_007_199_254_740_993n;
      const expectedGasLimit = 9_007_199_254_749_788n;
      const roundedGasLimit = 9_007_199_254_749_787n;

      expect(isGasLimitTargetCompatible(parentGasLimit, expectedGasLimit, expectedGasLimit)).toBe(true);
      expect(isGasLimitTargetCompatible(parentGasLimit, roundedGasLimit, expectedGasLimit)).toBe(false);
    });
  });

  describe("appendBuilderToRegistry", () => {
    // At the fork transition the builders registry is append-only (no reusable slot exists), so the
    // scan-free appendBuilderToRegistry must produce a byte-identical registry to the scan-based
    // addBuilderToRegistry. addBuilderToRegistry is the oracle here.
    it("matches addBuilderToRegistry for append-only onboarding", () => {
      const slot = 0; // any slot; both paths compute depositEpoch identically
      const scanState = buildGloasState(slot);
      const appendState = buildGloasState(slot);

      const n = 256;
      for (let i = 0; i < n; i++) {
        const pubkey = new Uint8Array(48).fill(i & 0xff);
        const execAddr = new Uint8Array(20).fill(i & 0xff);
        const amount = MIN_DEPOSIT_AMOUNT + i; // balance > 0, as for a fresh builder at the fork

        addBuilderToRegistry(scanState, pubkey, PAYLOAD_BUILDER_VERSION, execAddr, amount, slot);
        appendBuilderToRegistry(appendState, pubkey, PAYLOAD_BUILDER_VERSION, execAddr, amount, slot);

        // byte-for-byte registry equivalence after every onboard
        expect(appendState.builders.hashTreeRoot()).toEqual(scanState.builders.hashTreeRoot());
      }

      expect(appendState.builders.length).toBe(n);
      const builder = appendState.builders.getReadonly(n - 1);
      expect(builder.withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
      expect(builder.version).toBe(PAYLOAD_BUILDER_VERSION);
    });
  });
});
