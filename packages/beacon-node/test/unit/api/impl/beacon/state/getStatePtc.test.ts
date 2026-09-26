import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateGloas, BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/index.js";
import * as stateUtils from "../../../../../../src/api/impl/beacon/state/utils.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateCachedElectraState, generateState} from "../../../../../utils/state.js";

describe("getStatePtc", () => {
  const stateSlot = 3 * SLOTS_PER_EPOCH + 7;
  const firstSlot = 2 * SLOTS_PER_EPOCH;
  const lastSlot = (4 + MIN_SEED_LOOKAHEAD) * SLOTS_PER_EPOCH - 1;
  const stateId = `0x${"12".repeat(32)}`;
  const validators = ssz.gloas.PayloadTimelinessCommittee.defaultValue();
  validators.splice(0, 3, 7, 2, 7);
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconStateApi>;

  beforeEach(() => {
    const config = getConfig(ForkName.gloas, 1);
    const state = generateState({slot: stateSlot}, config, true) as BeaconStateGloas;
    state.ptcWindow.set(
      SLOTS_PER_EPOCH + (stateSlot % SLOTS_PER_EPOCH),
      ssz.gloas.PayloadTimelinessCommittee.toViewDU(validators)
    );
    const view = new BeaconStateView(
      createCachedBeaconState(state, {config: createBeaconConfig(config, state.genesisValidatorsRoot), pubkeyCache})
    );
    modules = getApiTestModules({config});
    api = getBeaconStateApi(modules);
    vi.spyOn(stateUtils, "getStateResponseWithRegen").mockResolvedValue({
      state: view,
      executionOptimistic: true,
      finalized: false,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("defaults to the selected state's slot and preserves committee order and duplicates", async () => {
    expect(await api.getStatePtc({stateId})).toEqual({
      data: {slot: stateSlot, validators},
      meta: {executionOptimistic: true, finalized: false},
    });
    expect(stateUtils.getStateResponseWithRegen).toHaveBeenCalledWith(modules.chain, modules.sync, stateId);
  });

  it.each([firstSlot, stateSlot + 1, lastSlot])("serves slot %i within the state's PTC window", async (slot) => {
    const {data} = await api.getStatePtc({stateId, slot});
    expect(data).toEqual({slot, validators: ssz.gloas.PayloadTimelinessCommittee.defaultValue()});
  });

  it.each([firstSlot - 1, lastSlot + 1])("rejects slot %i outside the state's PTC window", async (slot) => {
    await expect(api.getStatePtc({stateId, slot})).rejects.toMatchObject({
      statusCode: 400,
      message: "Slot is outside the PTC window of the state",
    });
  });

  it("rejects pre-Gloas slots even within the state's PTC window", async () => {
    modules.config.GLOAS_FORK_EPOCH = 3;
    await expect(api.getStatePtc({stateId, slot: firstSlot})).rejects.toMatchObject({statusCode: 400});
  });

  it("rejects pre-Gloas states", async () => {
    vi.mocked(stateUtils.getStateResponseWithRegen).mockResolvedValue({
      state: new BeaconStateView(generateCachedElectraState()),
      executionOptimistic: false,
      finalized: true,
    });
    await expect(api.getStatePtc({stateId})).rejects.toMatchObject({statusCode: 400});
  });
});
