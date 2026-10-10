import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, NativeBeaconStateView, createBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ChainEventEmitter, initializeForkChoice} from "../../../../src/chain/index.js";
import {generateValidators} from "../../../utils/validator.js";

vi.unmock("@lodestar/fork-choice");

describe("native Gloas fork choice", () => {
  it.each([true, false])("preserves the execution hash when isFinalizedState=%s", (isFinalizedState) => {
    const state = ssz.gloas.BeaconState.defaultValue();
    state.slot = 3 * SLOTS_PER_EPOCH;
    state.latestBlockHeader.slot = state.slot;
    state.latestBlockHeader.parentRoot.fill(3);
    state.finalizedCheckpoint = {epoch: 1, root: new Uint8Array(32).fill(1)};
    state.currentJustifiedCheckpoint = {epoch: 2, root: new Uint8Array(32).fill(2)};
    state.blockRoots[2 * SLOTS_PER_EPOCH] = state.currentJustifiedCheckpoint.root;
    state.latestBlockHash.fill(7);
    state.latestExecutionPayloadBid.blockHash.fill(9);
    state.validators = generateValidators(16, {
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
    });
    state.balances = state.validators.map(() => MAX_EFFECTIVE_BALANCE);
    state.inactivityScores = state.validators.map(() => 0);
    state.previousEpochParticipation = state.validators.map(() => 0);
    state.currentEpochParticipation = state.validators.map(() => 0);
    state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
    state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);

    const config = createBeaconConfig(getConfig(ForkName.gloas), state.genesisValidatorsRoot);
    const stateBytes = ssz.gloas.BeaconState.serialize(state);
    pubkeyCache.ensureCapacity(state.validators.length);
    for (const nativeStateTransition of [false, true]) {
      const view = createBeaconStateView({nativeStateTransition, config, stateBytes});
      try {
        expect(view).toBeInstanceOf(nativeStateTransition ? NativeBeaconStateView : BeaconStateView);
        const forkChoice = initializeForkChoice(
          config,
          new ChainEventEmitter(),
          state.slot,
          view,
          isFinalizedState,
          {},
          () => view.getEffectiveBalanceIncrementsZeroInactive(),
          () => null,
          null
        );
        const head = forkChoice.getHead();
        expect(head.slot, `nativeStateTransition=${nativeStateTransition}`).toBe(state.slot);
        expect(head.executionPayloadBlockHash, `nativeStateTransition=${nativeStateTransition}`).toBe(
          toRootHex(state.latestBlockHash)
        );
        expect(head.parentBlockHash, `nativeStateTransition=${nativeStateTransition}`).toBe(
          toRootHex(state.latestBlockHash)
        );
        expect(head.executionStatus, `nativeStateTransition=${nativeStateTransition}`).toBe(ExecutionStatus.Syncing);
      } finally {
        view.release();
      }
    }
  });
});
