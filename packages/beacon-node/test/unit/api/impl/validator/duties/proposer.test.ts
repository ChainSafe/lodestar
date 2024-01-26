import {describe, it, expect, beforeEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {generateState, zeroProtoBlock} from "../../../../../utils/state.js";
import {generateValidators} from "../../../../../utils/validator.js";
import {createCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";

describe.skip("get proposers api impl", function () {
  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;

  beforeEach(function () {
    modules = getApiTestModules();
    api = getValidatorApi(modules);

    modules.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
  });

  it("should get proposers for next epoch", async function () {
    modules.sync.isSynced.mockReturnValue(true);
    vi.spyOn(modules.chain.clock, "currentEpoch", "get").mockReturnValue(0);
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(0);
    modules.db.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );

    const cachedState = createCachedBeaconStateTest(state, config);
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    const stubGetNextBeaconProposer = vi.spyOn(cachedState.epochCtx, "getBeaconProposersNextEpoch");
    const stubGetBeaconProposer = vi.spyOn(cachedState.epochCtx, "getBeaconProposer");
    stubGetNextBeaconProposer.mockReturnValue([1]);
    const {data: result} = await api.getProposerDuties(1);
    expect(result.length).toBe(SLOTS_PER_EPOCH);
    // "stubGetBeaconProposer function should not have been called"
    expect(stubGetNextBeaconProposer).toHaveBeenCalledWith();
    // "stubGetBeaconProposer function should have been called"
    expect(stubGetBeaconProposer).not.toHaveBeenCalledWith();
  });

  it("should have different proposer for current and next epoch", async function () {
    modules.sync.isSynced.mockReturnValue(true);
    vi.spyOn(modules.chain.clock, "currentEpoch", "get").mockReturnValue(0);
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(0);
    modules.db.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    const cachedState = createCachedBeaconStateTest(state, config);
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    const stubGetBeaconProposer = vi.spyOn(cachedState.epochCtx, "getBeaconProposer");
    stubGetBeaconProposer.mockReturnValue(1);
    const {data: currentProposers} = await api.getProposerDuties(0);
    const {data: nextProposers} = await api.getProposerDuties(1);
    expect(currentProposers).not.toEqual(nextProposers);
  });

  it("should not get proposers for more than one epoch in the future", async function () {
    modules.sync.isSynced.mockReturnValue(true);
    vi.spyOn(modules.chain.clock, "currentEpoch", "get").mockReturnValue(0);
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(0);
    modules.db.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    const cachedState = createCachedBeaconStateTest(state, config);
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    const stubGetBeaconProposer = vi.spyOn(cachedState.epochCtx, "getBeaconProposer");
    await expect(stubGetBeaconProposer).rejects.toThrow();
    await expect(api.getProposerDuties(2)).rejects.toThrow();
  });
});
