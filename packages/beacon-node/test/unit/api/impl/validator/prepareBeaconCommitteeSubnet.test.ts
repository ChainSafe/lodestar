import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

describe("api/validator - prepareBeaconCommitteeSubnet", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  beforeEach(() => {
    modules = getApiTestModules();
    api = getValidatorApi(defaultApiOptions, modules);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    vi.spyOn(modules.chain.clock, "currentEpoch", "get").mockReturnValue(5);
    modules.network.prepareBeaconCommitteeSubnets = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("tracks the subscribing validators as attached to the node", async () => {
    const subscription = {committeesAtSlot: 2, committeeIndex: 1, slot: 160, isAggregator: false};

    await api.prepareBeaconCommitteeSubnet({
      subscriptions: [
        {...subscription, validatorIndex: 7},
        {...subscription, validatorIndex: 7, slot: 161},
        {...subscription, validatorIndex: 9},
      ],
    });

    expect(modules.network.prepareBeaconCommitteeSubnets).toHaveBeenCalledOnce();
    expect(modules.chain.updateAttachedValidators).toHaveBeenCalledExactlyOnceWith(5, [7, 9]);
  });

  it("tracks the subscribing validators while syncing", async () => {
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Stalled);
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(5 * SLOTS_PER_EPOCH);

    await expect(
      api.prepareBeaconCommitteeSubnet({
        subscriptions: [{committeesAtSlot: 2, committeeIndex: 1, slot: 160, isAggregator: false, validatorIndex: 7}],
      })
    ).rejects.toThrow("waiting for peers");

    expect(modules.chain.updateAttachedValidators).toHaveBeenCalledExactlyOnceWith(5, [7]);
    expect(modules.network.prepareBeaconCommitteeSubnets).not.toHaveBeenCalled();
  });

  it("does not fail the subscription if tracking the validators fails", async () => {
    modules.chain.updateAttachedValidators.mockRejectedValueOnce(new Error("no finalized state"));

    await api.prepareBeaconCommitteeSubnet({
      subscriptions: [{committeesAtSlot: 2, committeeIndex: 1, slot: 160, isAggregator: false, validatorIndex: 7}],
    });

    expect(modules.network.prepareBeaconCommitteeSubnets).toHaveBeenCalledOnce();
    expect(modules.logger.error).toHaveBeenCalledOnce();
  });
});
