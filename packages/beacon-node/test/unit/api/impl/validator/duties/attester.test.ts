import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

describe("get attester duties api impl", () => {
  const config = getConfig(ForkName.fulu);
  // Genesis is a few slots away, so the clock epoch is -1
  const genesisTime = 12;

  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;
  const passedEpochCheck = new Error("passed epoch check");

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    modules = getApiTestModules({clock: "real", config, genesisTime});
    api = getValidatorApi(defaultApiOptions, modules);
    // Stop right after the epoch check, computing the duties is not under test
    modules.chain.getHeadStateAtCurrentEpoch.mockRejectedValue(passedEpochCheck);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([0, 1])("should accept epoch %i before genesis", async (epoch) => {
    expect(modules.chain.clock.currentEpoch).toBe(-1);
    await expect(api.getAttesterDuties({epoch, indices: [0]})).rejects.toBe(passedEpochCheck);
  });

  it("should reject epoch 2 before genesis", async () => {
    await expect(api.getAttesterDuties({epoch: 2, indices: [0]})).rejects.toThrow(
      "Cannot get duties for epoch more than one ahead"
    );
  });
});
