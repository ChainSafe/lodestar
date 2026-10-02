import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, IBeaconStateView, isStatePostGloas} from "@lodestar/state-transition";
import {Slot, ValidatorIndex} from "@lodestar/types";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {SyncState} from "../../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {createCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";
import {generateState, zeroProtoBlock} from "../../../../../utils/state.js";
import {generateValidators} from "../../../../../utils/validator.js";

describe("get ptc duties api impl", () => {
  const gloasEpoch = 1;
  const gloasStartSlot = gloasEpoch * SLOTS_PER_EPOCH;
  const config = getConfig(ForkName.gloas, gloasEpoch);
  const validatorCount = 64;
  const indices = Array.from({length: validatorCount}, (_, i) => i);

  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;
  let fuluState: IBeaconStateView;

  beforeEach(() => {
    vi.useFakeTimers({now: 0});
    modules = getApiTestModules({clock: "real", config});
    api = getValidatorApi(defaultApiOptions, modules);

    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(validatorCount, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: validatorCount}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    fuluState = new BeaconStateView(createCachedBeaconStateTest(state, config));

    modules.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getExpectedDuties(gloasState: IBeaconStateView): {validatorIndex: ValidatorIndex; slot: Slot}[] {
    if (!isStatePostGloas(gloasState)) {
      throw Error(`Expected post-Gloas state fork=${gloasState.forkName}`);
    }
    const ptcs = gloasState.getEpochPTCs(gloasEpoch);
    const duties: {validatorIndex: ValidatorIndex; slot: Slot}[] = [];
    for (const validatorIndex of indices) {
      const slotIndex = ptcs.findIndex((ptc) => ptc.includes(validatorIndex));
      if (slotIndex !== -1) {
        duties.push({validatorIndex, slot: gloasStartSlot + slotIndex});
      }
    }
    return duties;
  }

  it("should get first Gloas epoch duties from a pre-Gloas head state", async () => {
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(fuluState);

    const {data} = (await api.getPtcDuties({epoch: gloasEpoch, indices})) as {data: routes.validator.PtcDutyList};

    const expected = getExpectedDuties(fuluState.processSlots(gloasStartSlot, {dontTransferCache: true}));
    expect(expected.length).toBeGreaterThan(0);
    expect(data.map(({validatorIndex, slot}) => ({validatorIndex, slot}))).toEqual(expected);
    expect(fuluState.slot).toBe(0);
    expect(fuluState.forkName).toBe(ForkName.fulu);
  });

  it("should get duties from a post-Gloas head state without dialing it", async () => {
    vi.advanceTimersByTime(gloasStartSlot * config.SLOT_DURATION_MS);
    const gloasState = fuluState.processSlots(gloasStartSlot, {dontTransferCache: true});
    vi.spyOn(gloasState, "processSlots");
    modules.chain.getHeadStateAtCurrentEpoch.mockResolvedValue(gloasState);

    const {data} = (await api.getPtcDuties({epoch: gloasEpoch, indices})) as {data: routes.validator.PtcDutyList};

    expect(data.map(({validatorIndex, slot}) => ({validatorIndex, slot}))).toEqual(getExpectedDuties(gloasState));
    expect(gloasState.processSlots).not.toHaveBeenCalled();
  });

  it("should raise error for a pre-Gloas epoch", async () => {
    await expect(api.getPtcDuties({epoch: gloasEpoch - 1, indices})).rejects.toThrow(
      "PTC duties are not supported before Gloas fork=fulu"
    );
  });
});
