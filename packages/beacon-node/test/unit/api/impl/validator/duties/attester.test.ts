import {afterEach, describe, expect, it, vi} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

describe("get attester duties api impl", () => {
  const config = getConfig(ForkName.fulu);
  const epochDurationSec = (SLOTS_PER_EPOCH * config.SLOT_DURATION_MS) / 1000;
  const passedEpochCheck = new Error("passed epoch check");

  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;

  function setup(genesisTime: number): void {
    vi.useFakeTimers({now: 0});
    modules = getApiTestModules({clock: "real", config, genesisTime});
    api = getValidatorApi(defaultApiOptions, modules);
    // Stop right after the epoch check, computing the duties is not under test
    modules.chain.getHeadStateAtCurrentEpoch.mockRejectedValue(passedEpochCheck);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Validator clients often start well before genesis, so cover both a near and a distant genesis
  describe.each([
    {name: "a few slots", genesisTime: 12, clockEpoch: -1},
    {name: "more than one epoch", genesisTime: 10 * epochDurationSec, clockEpoch: -10},
  ])("genesis $name away", ({genesisTime, clockEpoch}) => {
    it.each([0, 1])("should accept epoch %i", async (epoch) => {
      setup(genesisTime);
      expect(modules.chain.clock.currentEpoch).toBe(clockEpoch);
      await expect(api.getAttesterDuties({epoch, indices: [0]})).rejects.toBe(passedEpochCheck);
    });

    it("should reject epoch 2", async () => {
      setup(genesisTime);
      await expect(api.getAttesterDuties({epoch: 2, indices: [0]})).rejects.toThrow(
        "Cannot get duties for epoch more than one ahead"
      );
    });
  });
});
