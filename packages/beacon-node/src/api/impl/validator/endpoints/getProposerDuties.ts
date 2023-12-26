import {ServerApi, routes} from "@lodestar/api";
import {
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  proposerShufflingDecisionRoot,
} from "@lodestar/state-transition";
import {ValidatorIndex} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHex} from "@lodestar/utils";
import {RegenCaller} from "../../../../chain/regen/interface.js";
import {ApiModules} from "../../types.js";
import {getPubkeysForIndices} from "../utils.js";
import {SCHEDULER_LOOKAHEAD_FACTOR} from "../../../../chain/prepareNextSlot.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildGetProposerDuties(
  {chain, config, metrics}: ApiModules,
  {
    notWhileSyncing,
    getGenesisBlockRoot,
    currentEpochWithDisparity,
    msToNextEpoch,
    waitForCheckpointState,
  }: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["getProposerDuties"] {
  return async function getProposerDuties(epoch) {
    notWhileSyncing();

    // Early check that epoch is within [current_epoch, current_epoch + 1], or allow for pre-genesis
    const currentEpoch = currentEpochWithDisparity();
    const nextEpoch = currentEpoch + 1;
    if (currentEpoch >= 0 && epoch !== currentEpoch && epoch !== nextEpoch) {
      throw Error(`Requested epoch ${epoch} must equal current ${currentEpoch} or next epoch ${nextEpoch}`);
    }

    const head = chain.forkChoice.getHead();
    let state: CachedBeaconStateAllForks | undefined = undefined;
    const slotMs = config.SECONDS_PER_SLOT * 1000;
    const prepareNextSlotLookAheadMs = slotMs / SCHEDULER_LOOKAHEAD_FACTOR;
    const toNextEpochMs = msToNextEpoch();
    // validators may request next epoch's duties when it's close to next epoch
    // this is to avoid missed block proposal due to 0 epoch look ahead
    if (epoch === nextEpoch && toNextEpochMs < prepareNextSlotLookAheadMs) {
      // wait for maximum 1 slot for cp state which is the timeout of validator api
      const cpState = await waitForCheckpointState({rootHex: head.blockRoot, epoch});
      if (cpState) {
        state = cpState;
        metrics?.duties.requestNextEpochProposalDutiesHit.inc();
      } else {
        metrics?.duties.requestNextEpochProposalDutiesMiss.inc();
      }
    }

    if (!state) {
      state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.getDuties);
    }

    const stateEpoch = state.epochCtx.epoch;
    let indexes: ValidatorIndex[] = [];

    if (epoch === stateEpoch) {
      indexes = state.epochCtx.getBeaconProposers();
    } else if (epoch === stateEpoch + 1) {
      // Requesting duties for next epoch is allow since they can be predicted with high probabilities.
      // @see `epochCtx.getBeaconProposersNextEpoch` JSDocs for rationale.
      indexes = state.epochCtx.getBeaconProposersNextEpoch();
    } else {
      // Should never happen, epoch is checked to be in bounds above
      throw Error(`Proposer duties for epoch ${epoch} not supported, current epoch ${stateEpoch}`);
    }

    // NOTE: this is the fastest way of getting compressed pubkeys.
    //       See benchmark -> packages/lodestar/test/perf/api/impl/validator/attester.test.ts
    // After dropping the flat caches attached to the CachedBeaconState it's no longer available.
    // TODO: Add a flag to just send 0x00 as pubkeys since the Lodestar validator does not need them.
    const pubkeys = getPubkeysForIndices(state.validators, indexes);

    const startSlot = computeStartSlotAtEpoch(stateEpoch);
    const duties: routes.validator.ProposerDuty[] = [];
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      duties.push({slot: startSlot + i, validatorIndex: indexes[i], pubkey: pubkeys[i]});
    }

    // Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
    // It should be set to the latest block applied to `self` or the genesis block root.
    const dependentRoot = proposerShufflingDecisionRoot(state) || (await getGenesisBlockRoot(state));

    return {
      data: duties,
      dependentRoot: toHex(dependentRoot),
      executionOptimistic: isOptimisticBlock(head),
    };
  };
}
