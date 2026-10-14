import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateGloas, BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/index.js";
import {BeaconEngineCore} from "../../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {RegenCaller} from "../../../../../../src/chain/regen/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateCachedElectraState, generateState} from "../../../../../utils/state.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

describe("getStatePtc", () => {
  const stateSlot = 3 * SLOTS_PER_EPOCH + 7;
  const firstSlot = 2 * SLOTS_PER_EPOCH;
  const lastSlot = (4 + MIN_SEED_LOOKAHEAD) * SLOTS_PER_EPOCH - 1;
  const stateId = `0x${"12".repeat(32)}`;
  const validators = ssz.gloas.PayloadTimelinessCommittee.defaultValue();
  validators.splice(0, 3, 7, 2, 7);
  const getState = vi.fn();
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
    modules.forkChoice.getFinalizedBlock.mockReturnValue(generateProtoBlock());
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 1,
      root: new Uint8Array(32),
      rootHex: `0x${"00".repeat(32)}`,
    });
    modules.forkChoice.getBlockDefaultStatus.mockReturnValue(
      generateProtoBlock({executionStatus: ExecutionStatus.Syncing})
    );
    modules.db.blockArchive.get.mockResolvedValue(null);
    Object.assign(modules.chain, {
      beaconEngine: Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
        config: modules.config,
        forkChoice: modules.forkChoice,
        db: modules.db,
        regen: {getState},
      }),
    });
    api = getBeaconStateApi(modules);
    getState.mockResolvedValue(view);
  });

  afterEach(() => vi.restoreAllMocks());

  it("defaults to the selected state's slot and preserves committee order and duplicates", async () => {
    expect(await api.getStatePtc({stateId})).toEqual({
      data: {slot: stateSlot, validators},
      meta: {executionOptimistic: true, finalized: false},
    });
    expect(getState).toHaveBeenCalledWith(stateId, RegenCaller.restApi);
  });

  it.each([firstSlot, stateSlot + 1, lastSlot])("serves slot %i within the state's PTC window", async (slot) => {
    const {data} = await api.getStatePtc({stateId, slot});
    expect(data).toEqual({slot, validators: ssz.gloas.PayloadTimelinessCommittee.defaultValue()});
  });

  it.each([firstSlot - 1, lastSlot + 1])("rejects slot %i outside the state's PTC window", async (slot) => {
    await expect(api.getStatePtc({stateId, slot})).rejects.toMatchObject({
      statusCode: 400,
      message: `Slot ${slot} is outside the PTC window of state epoch 3`,
    });
  });

  it("rejects pre-Gloas slots even within the state's PTC window", async () => {
    modules.config.GLOAS_FORK_EPOCH = 3;
    await expect(api.getStatePtc({stateId, slot: firstSlot})).rejects.toMatchObject({
      statusCode: 400,
      message: `Cannot retrieve PTC for pre-gloas slot=${firstSlot}`,
    });
  });

  it("serves the genesis slot when Gloas starts at genesis", async () => {
    const config = getConfig(ForkName.gloas, 0);
    const state = generateState({slot: 0}, config, true) as BeaconStateGloas;
    state.ptcWindow.set(SLOTS_PER_EPOCH, ssz.gloas.PayloadTimelinessCommittee.toViewDU(validators));
    const view = new BeaconStateView(
      createCachedBeaconState(state, {config: createBeaconConfig(config, state.genesisValidatorsRoot), pubkeyCache})
    );
    getState.mockResolvedValue(view);
    modules.forkChoice.getBlockDefaultStatus.mockReturnValue(
      generateProtoBlock({executionStatus: ExecutionStatus.Valid})
    );
    const genesisModules = getApiTestModules({config});
    Object.assign(genesisModules.chain, {
      beaconEngine: Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
        config,
        forkChoice: modules.forkChoice,
        db: modules.db,
        regen: {getState},
      }),
    });
    const genesisApi = getBeaconStateApi(genesisModules);
    expect(await genesisApi.getStatePtc({stateId, slot: 0})).toEqual({
      data: {slot: 0, validators},
      meta: {executionOptimistic: false, finalized: true},
    });
  });

  it("rejects pre-Gloas states", async () => {
    getState.mockResolvedValue(new BeaconStateView(generateCachedElectraState()));
    await expect(api.getStatePtc({stateId})).rejects.toMatchObject({statusCode: 400});
  });
});
