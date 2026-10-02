import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {SyncState} from "../../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {createCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";
import {generateState, zeroProtoBlock} from "../../../../../utils/state.js";
import {generateValidators} from "../../../../../utils/validator.js";

describe("get ptc duties api impl", () => {
  // Gloas activates at epoch 1 so the fork boundary can be exercised: a validator client requests
  // PTC duties for epoch 1 while the clock and head state are still at the pre-Gloas epoch 0.
  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 1,
  });
  const config = createBeaconConfig(chainConfig, Buffer.alloc(32, 0xaa));
  const gloasEpoch = 1;
  const validatorCount = 25;
  const indices = Array.from({length: validatorCount}, (_, i) => i);

  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;

  function generateCachedStateAtSlot(slot: Slot): BeaconStateView {
    const state = generateState(
      {
        slot,
        validators: generateValidators(validatorCount, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: validatorCount}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    return new BeaconStateView(createCachedBeaconStateTest(state, config));
  }

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    modules = getApiTestModules({clock: "real", config});
    api = getValidatorApi(defaultApiOptions, modules);

    modules.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the first Gloas epoch's PTC duties when the head state is still pre-Gloas", async () => {
    // Clock stays at the pre-Gloas epoch 0, head state at current epoch is pre-Gloas (fulu).
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(generateCachedStateAtSlot(0));
    // Regen at the requested (post-Gloas) epoch returns a Gloas state.
    modules.chain.getHeadStateAtEpoch.mockResolvedValue(generateCachedStateAtSlot(SLOTS_PER_EPOCH * gloasEpoch));

    const {data} = await api.getPtcDuties({epoch: gloasEpoch, indices});

    expect(Array.isArray(data)).toBe(true);
    // The fork-boundary fallback must regen the state at the requested epoch instead of throwing.
    expect(modules.chain.getHeadStateAtEpoch).toHaveBeenCalledWith(gloasEpoch, expect.anything());
  });

  it("serves PTC duties from the current-epoch head state without regen once Gloas is active", async () => {
    vi.advanceTimersByTime(SLOTS_PER_EPOCH * gloasEpoch * config.SLOT_DURATION_MS);
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(generateCachedStateAtSlot(SLOTS_PER_EPOCH * gloasEpoch));

    const {data} = await api.getPtcDuties({epoch: gloasEpoch, indices});

    expect(Array.isArray(data)).toBe(true);
    expect(modules.chain.getHeadStateAtEpoch).not.toHaveBeenCalled();
  });

  it("rejects PTC duties requested for a pre-Gloas epoch", async () => {
    await expect(api.getPtcDuties({epoch: 0, indices})).rejects.toThrow("PTC duties are not supported before Gloas");
  });
});
