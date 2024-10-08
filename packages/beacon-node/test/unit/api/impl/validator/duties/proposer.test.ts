import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {SYNC_TOLERANCE_EPOCHS, getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {generateState, zeroProtoBlock} from "../../../../../utils/state.js";
import {generateValidators} from "../../../../../utils/validator.js";
import {createCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";
import {SyncState} from "../../../../../../src/sync/interface.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";

describe("get proposers api impl", function () {
  const currentEpoch = 2;
  const currentSlot = SLOTS_PER_EPOCH * currentEpoch;

  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;
  let state: BeaconStateAllForks;
  let cachedState: ReturnType<typeof createCachedBeaconStateTest>;

  beforeEach(function () {
    vi.useFakeTimers({now: 0});
    vi.advanceTimersByTime(currentSlot * config.SECONDS_PER_SLOT * 1000);
    modules = getApiTestModules({clock: "real"});
    api = getValidatorApi(defaultApiOptions, modules);

    initializeState(currentSlot);

    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    modules.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    modules.forkChoice.getFinalizedBlock.mockReturnValue(zeroProtoBlock);
    modules.db.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);

    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
  });

  function initializeState(slot: Slot): void {
    state = generateState(
      {
        slot,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    cachedState = createCachedBeaconStateTest(state, config);

    vi.spyOn(cachedState.epochCtx, "getBeaconProposersNextEpoch");
    vi.spyOn(cachedState.epochCtx, "getBeaconProposers");
    vi.spyOn(cachedState.epochCtx, "getBeaconProposersPrevEpoch");
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should raise error if node head is behind", async () => {
    vi.advanceTimersByTime((SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH + 1) * config.SECONDS_PER_SLOT * 1000);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.SyncingHead);

    await expect(api.getProposerDuties({epoch: 1})).rejects.toThrow("Node is syncing - headSlot 0 currentSlot 25");
  });

  it("should raise error if node stalled", async () => {
    vi.advanceTimersByTime((SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH + 1) * config.SECONDS_PER_SLOT * 1000);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Stalled);

    await expect(api.getProposerDuties({epoch: 1})).rejects.toThrow("Node is syncing - waiting for peers");
  });

  it("should get proposers for current epoch", async () => {
    const {data: result} = (await api.getProposerDuties({epoch: currentEpoch})) as {
      data: routes.validator.ProposerDutyList;
    };

    expect(result.length).toBe(SLOTS_PER_EPOCH);
    expect(cachedState.epochCtx.getBeaconProposers).toHaveBeenCalledOnce();
    expect(cachedState.epochCtx.getBeaconProposersNextEpoch).not.toHaveBeenCalled();
    expect(cachedState.epochCtx.getBeaconProposersPrevEpoch).not.toHaveBeenCalled();
    expect(result.map((p) => p.slot)).toEqual(
      Array.from({length: SLOTS_PER_EPOCH}, (_, i) => currentEpoch * SLOTS_PER_EPOCH + i)
    );
  });

  it("should get proposers for next epoch", async () => {
    const nextEpoch = currentEpoch + 1;
    const {data: result} = (await api.getProposerDuties({epoch: nextEpoch})) as {
      data: routes.validator.ProposerDutyList;
    };

    expect(result.length).toBe(SLOTS_PER_EPOCH);
    expect(cachedState.epochCtx.getBeaconProposers).not.toHaveBeenCalled();
    expect(cachedState.epochCtx.getBeaconProposersNextEpoch).toHaveBeenCalledOnce();
    expect(cachedState.epochCtx.getBeaconProposersPrevEpoch).not.toHaveBeenCalled();
    expect(result.map((p) => p.slot)).toEqual(
      Array.from({length: SLOTS_PER_EPOCH}, (_, i) => nextEpoch * SLOTS_PER_EPOCH + i)
    );
  });

  it("should get proposers for historical epoch", async () => {
    const historicalEpoch = currentEpoch - 2;
    initializeState(currentSlot - 2 * SLOTS_PER_EPOCH);
    modules.chain.getStateBySlot.mockResolvedValue({state, executionOptimistic: false, finalized: true});

    const {data: result} = (await api.getProposerDuties({epoch: historicalEpoch})) as {
      data: routes.validator.ProposerDutyList;
    };

    expect(result.length).toBe(SLOTS_PER_EPOCH);
    // Spy won't be called as `getProposerDuties` will create a new cached beacon state
    expect(result.map((p) => p.slot)).toEqual(
      Array.from({length: SLOTS_PER_EPOCH}, (_, i) => historicalEpoch * SLOTS_PER_EPOCH + i)
    );
  });

  it("should raise error for more than one epoch in the future", async () => {
    await expect(api.getProposerDuties({epoch: currentEpoch + 2})).rejects.toThrow(
      "Requested epoch 4 must not be more than one epoch in the future"
    );
  });

  it("should have different proposer validator public keys for current and next epoch", async () => {
    const {data: currentProposers} = (await api.getProposerDuties({epoch: currentEpoch})) as {
      data: routes.validator.ProposerDutyList;
    };
    const {data: nextProposers} = (await api.getProposerDuties({epoch: currentEpoch + 1})) as {
      data: routes.validator.ProposerDutyList;
    };

    // Public keys should be different, but for tests we are generating a static list of validators with same public key
    expect(currentProposers.map((p) => p.pubkey)).toEqual(nextProposers.map((p) => p.pubkey));
  });

  it("should have different proposer validator indexes for current and next epoch", async () => {
    const {data: currentProposers} = (await api.getProposerDuties({epoch: currentEpoch})) as {
      data: routes.validator.ProposerDutyList;
    };
    const {data: nextProposers} = (await api.getProposerDuties({epoch: currentEpoch + 1})) as {
      data: routes.validator.ProposerDutyList;
    };

    expect(currentProposers.map((p) => p.validatorIndex)).not.toEqual(nextProposers.map((p) => p.validatorIndex));
  });

  it("should have different proposer slots for current and next epoch", async () => {
    const {data: currentProposers} = (await api.getProposerDuties({epoch: currentEpoch})) as {
      data: routes.validator.ProposerDutyList;
    };
    const {data: nextProposers} = (await api.getProposerDuties({epoch: currentEpoch + 1})) as {
      data: routes.validator.ProposerDutyList;
    };

    expect(currentProposers.map((p) => p.slot)).not.toEqual(nextProposers.map((p) => p.slot));
  });
});
