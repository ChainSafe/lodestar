import {describe, expect, it, vi} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {MetricsRegister} from "@lodestar/utils";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../src/block/externalData.js";
import {getMetrics} from "../../src/metrics.js";
import {StateCloneSource, processSlots, stateTransition} from "../../src/stateTransition.js";
import {generateCachedState} from "../../src/testUtils/state.js";
import {generateValidators} from "../utils/validator.js";

describe.each(Object.values(StateCloneSource))("%s clone metrics", (source) => {
  it.each([false, true])("records source reuse with dontTransferCache=%s", (dontTransferCache) => {
    const metrics = getMetrics({
      gauge: () => ({inc: vi.fn(), dec: vi.fn(), set: vi.fn(), reset: vi.fn()}),
      histogram: () => ({observe: vi.fn(), startTimer: () => () => 0, reset: vi.fn()}),
      counter: () => ({inc: vi.fn()}),
    } as MetricsRegister);
    const validators = generateValidators(16, {
      activation: 0,
      exit: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      balance: MAX_EFFECTIVE_BALANCE,
    });
    const state = generateCachedState(getConfig(ForkName.phase0), {
      slot: 1,
      validators,
      balances: validators.map(() => MAX_EFFECTIVE_BALANCE),
    });
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = state.slot;
    signedBlock.message.proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
    signedBlock.message.parentRoot = state.latestBlockHeader.hashTreeRoot();

    for (let count = 1; count <= 2; count++) {
      state.validators.getAllReadonlyValues();
      state.balances.getAll();
      state.commit();

      if (source === StateCloneSource.stateTransition) {
        stateTransition(
          state,
          signedBlock,
          {
            dontTransferCache,
            verifyStateRoot: false,
            verifyProposer: false,
            verifySignatures: false,
            executionPayloadStatus: ExecutionPayloadStatus.valid,
            dataAvailabilityStatus: DataAvailabilityStatus.Available,
          },
          {metrics}
        );
      } else {
        processSlots(state, state.slot, {dontTransferCache}, {metrics});
      }

      expect(metrics.preStateClonedCount.observe).toHaveBeenNthCalledWith(count, count);
    }

    expect(metrics.preStateClonedCount.observe).toHaveBeenCalledTimes(2);
    for (const [hit, miss] of [
      [metrics.preStateValidatorsNodesPopulatedHit, metrics.preStateValidatorsNodesPopulatedMiss],
      [metrics.preStateBalancesNodesPopulatedHit, metrics.preStateBalancesNodesPopulatedMiss],
    ]) {
      const populated = dontTransferCache ? miss : hit;
      const unpopulated = dontTransferCache ? hit : miss;
      expect(populated.inc).toHaveBeenCalledTimes(2);
      expect(populated.inc).toHaveBeenCalledWith({source});
      expect(unpopulated.inc).not.toHaveBeenCalled();
    }
  });
});
