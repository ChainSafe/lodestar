import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, createCachedBeaconState, proposerShufflingDecisionRoot} from "@lodestar/state-transition";
import {ApiError} from "../../../../src/api/impl/errors.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {RegenCaller} from "../../../../src/chain/regen/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("BeaconEngine historical proposer duties", () => {
  function setup(fork: ForkName, finalizedEpoch = 2) {
    const chainConfig = getConfig(fork, 0);
    const historicalState = generateState({slot: SLOTS_PER_EPOCH}, chainConfig, true);
    const config = createBeaconConfig(chainConfig, historicalState.genesisValidatorsRoot);
    const historicalView = new BeaconStateView(createCachedBeaconState(historicalState, {config, pubkeyCache}));
    const headView = new BeaconStateView(
      createCachedBeaconState(generateState({slot: 4 * SLOTS_PER_EPOCH}, chainConfig, true), {config, pubkeyCache})
    );
    const head = generateProtoBlock({slot: headView.slot});
    const finalized = generateProtoBlock({slot: finalizedEpoch * SLOTS_PER_EPOCH});
    const historicalBlock = generateProtoBlock({slot: historicalView.slot});
    const getBlockSlotState = vi.fn().mockResolvedValue(historicalView);
    const getHistoricalStateBySlot = vi.fn<BeaconEngineCore["getHistoricalStateBySlot"]>().mockResolvedValue({
      state: historicalView.serialize(),
      executionOptimistic: false,
      finalized: true,
    });
    const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      config,
      clock: {currentSlot: headView.slot},
      forkChoice: {
        getHead: () => head,
        getFinalizedBlock: () => finalized,
        getCanonicalBlockClosestLteSlot: () => historicalBlock,
      },
      regen: {getBlockSlotState},
      getHeadState: () => headView,
      getHistoricalStateBySlot,
      logger: getMockedLogger(),
    });
    return {core, historicalView, historicalBlock, head, getBlockSlotState, getHistoricalStateBySlot};
  }

  for (const fork of [ForkName.phase0, ForkName.fulu, ForkName.gloas]) {
    it.each([false, true])(`serves archived ${fork} proposer duties with v2=%s`, async (v2) => {
      const {core, historicalView, head, getHistoricalStateBySlot} = setup(fork);

      const result = await core.getProposerDuties(1, {currentEpoch: 4}, v2);

      expect(result).toEqual({
        data: historicalView.currentProposers.map((validatorIndex, i) => ({
          slot: SLOTS_PER_EPOCH + i,
          validatorIndex,
          pubkey: historicalView.getValidator(validatorIndex).pubkey,
        })),
        dependentRoot: proposerShufflingDecisionRoot(v2 ? fork : ForkName.phase0, historicalView, 1),
        head,
      });
      expect(getHistoricalStateBySlot).toHaveBeenCalledExactlyOnceWith(SLOTS_PER_EPOCH);
    });
  }

  it("regenerates an old unfinalized epoch from its canonical block", async () => {
    const {core, historicalView, historicalBlock, getBlockSlotState, getHistoricalStateBySlot} = setup(
      ForkName.gloas,
      0
    );

    const result = await core.getProposerDuties(1, {currentEpoch: 4}, true);

    expect(result.data.map((duty) => duty.validatorIndex)).toEqual(historicalView.currentProposers);
    expect(getBlockSlotState).toHaveBeenCalledExactlyOnceWith(
      historicalBlock,
      SLOTS_PER_EPOCH,
      {dontTransferCache: true},
      RegenCaller.restApi
    );
    expect(getHistoricalStateBySlot).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested historical state is unavailable", async () => {
    const {core, getHistoricalStateBySlot} = setup(ForkName.gloas);
    getHistoricalStateBySlot.mockResolvedValue(null);

    await expect(core.getProposerDuties(1, {currentEpoch: 4}, true)).rejects.toEqual(
      new ApiError(404, `State not found for id '${SLOTS_PER_EPOCH}'`)
    );
  });
});
