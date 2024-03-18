import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {SYNC_TOLERANCE_EPOCHS, getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {generateState, zeroProtoBlock} from "../../../../../utils/state.js";
import {generateValidators} from "../../../../../utils/validator.js";
import {createFinalizedCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";
import {SyncState} from "../../../../../../src/sync/interface.js";

describe("get proposers api impl", function () {
  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;
  let state: BeaconStateAllForks;
  let cachedState: ReturnType<typeof createFinalizedCachedBeaconStateTest>;

  beforeEach(function () {
    vi.useFakeTimers({now: 0});
    modules = getApiTestModules({clock: "real"});
    api = getValidatorApi(modules);

    state = generateState(
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
    cachedState = createFinalizedCachedBeaconStateTest(state, config);

    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    modules.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    modules.db.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);

    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    vi.spyOn(cachedState.epochCtx, "getBeaconProposersNextEpoch");
    vi.spyOn(cachedState.epochCtx, "getBeaconProposers");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should raise error if node head is behind", async () => {
    vi.advanceTimersByTime((SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH + 1) * config.SECONDS_PER_SLOT * 1000);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.SyncingHead);

    await expect(api.getProposerDuties(1)).rejects.toThrow("Node is syncing - headSlot 0 currentSlot 9");
  });

  it("should raise error if node stalled", async () => {
    vi.advanceTimersByTime((SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH + 1) * config.SECONDS_PER_SLOT * 1000);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Stalled);

    await expect(api.getProposerDuties(1)).rejects.toThrow("Node is syncing - waiting for peers");
  });

  it("should get proposers for current epoch", async () => {
    const {data: result} = await api.getProposerDuties(0);

    expect(result.length).toBe(SLOTS_PER_EPOCH);
    expect(cachedState.epochCtx.getBeaconProposers).toHaveBeenCalledOnce();
    expect(cachedState.epochCtx.getBeaconProposersNextEpoch).not.toHaveBeenCalled();
    expect(result.map((p) => p.slot)).toEqual(Array.from({length: SLOTS_PER_EPOCH}, (_, i) => i));
  });

  it("should get proposers for next epoch", async () => {
    const {data: result} = await api.getProposerDuties(1);

    expect(result.length).toBe(SLOTS_PER_EPOCH);
    expect(cachedState.epochCtx.getBeaconProposers).not.toHaveBeenCalled();
    expect(cachedState.epochCtx.getBeaconProposersNextEpoch).toHaveBeenCalledOnce();
    expect(result.map((p) => p.slot)).toEqual(Array.from({length: SLOTS_PER_EPOCH}, (_, i) => SLOTS_PER_EPOCH + i));
  });

  it("should raise error for more than one epoch in the future", async () => {
    await expect(api.getProposerDuties(2)).rejects.toThrow("Requested epoch 2 must equal current 0 or next epoch 1");
  });

  it("should have different proposer validator public keys for current and next epoch", async () => {
    const {data: currentProposers} = await api.getProposerDuties(0);
    const {data: nextProposers} = await api.getProposerDuties(1);

    // Public keys should be different, but for tests we are generating a static list of validators with same public key
    expect(currentProposers.map((p) => p.pubkey)).toEqual(nextProposers.map((p) => p.pubkey));
  });

  it("should have different proposer validator indexes for current and next epoch", async () => {
    const {data: currentProposers} = await api.getProposerDuties(0);
    const {data: nextProposers} = await api.getProposerDuties(1);

    expect(currentProposers.map((p) => p.validatorIndex)).not.toEqual(nextProposers.map((p) => p.validatorIndex));
  });

  it("should have different proposer slots for current and next epoch", async () => {
    const {data: currentProposers} = await api.getProposerDuties(0);
    const {data: nextProposers} = await api.getProposerDuties(1);

    expect(currentProposers.map((p) => p.slot)).not.toEqual(nextProposers.map((p) => p.slot));
  });
});
