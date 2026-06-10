import {ForkName, ForkSeq, SLOTS_PER_EPOCH, isForkPostFulu} from "@lodestar/params";
import {
  Attestation,
  CommitteeIndex,
  Epoch,
  IndexedAttestation,
  Root,
  Slot,
  ValidatorIndex,
  electra,
} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {CachedBeaconStateAllForks} from "../cache/stateCache.js";
import {IBeaconStateView} from "../stateView/interface.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {EpochShuffling} from "./epochShuffling.js";

/**
 * Block root that decided the proposer shuffling for `proposalEpoch` (keys that shuffling).
 * Computed for the requested epoch, not `state.epoch`, so it is correct when `state` is one
 * epoch off the requested epoch (e.g. serving next-epoch duties from the current state).
 *
 * `headBlockRoot` is the canonical head block root applied to `state`. When the decision
 * slot is at or after `state.slot` (e.g. serving pre-Fulu `currentEpoch + 1` duties from
 * a mid-epoch head state), the head block root is returned as the dependent root. This
 * matches the beacon-API V1 rule of using the latest block applied to state when the
 * decision slot is not yet in `block_roots`, and aligns with Lighthouse's
 * `proposer_shuffling_decision_root_at_epoch` behavior.
 *
 * Returns `null` for the genesis-decides-its-own-shuffling case (`state.slot === 0 &&
 * decisionSlot === 0`); the caller must fall back to the canonical genesis block root
 * (typically via `getGenesisBlockRoot(state)`), because `headBlockRoot` may not equal
 * the genesis root when the chain has advanced and we are serving epoch-0 duties from a
 * loaded genesis state.
 */
export function proposerShufflingDecisionRoot(
  fork: ForkName,
  state: IBeaconStateView,
  proposalEpoch: Epoch,
  headBlockRoot: Root
): Root | null {
  const decisionSlot = proposerShufflingDecisionSlot(fork, proposalEpoch);
  if (state.slot === 0 && decisionSlot === 0) {
    return null;
  }
  if (state.slot <= decisionSlot) {
    return headBlockRoot;
  }
  return state.getBlockRootAtSlot(decisionSlot);
}

/** Slot whose block root keys the proposer shuffling for `proposalEpoch`. */
function proposerShufflingDecisionSlot(fork: ForkName, proposalEpoch: Epoch): Slot {
  // Post-Fulu the shuffling is decided one epoch earlier (deterministic proposer lookahead,
  // MIN_SEED_LOOKAHEAD = 1); pre-Fulu it is the last block before `proposalEpoch`.
  const decisionEpoch = isForkPostFulu(fork) ? proposalEpoch - 1 : proposalEpoch;
  return Math.max(computeStartSlotAtEpoch(decisionEpoch) - 1, 0);
}

/**
 * Returns the block root which decided the attester shuffling for the given `requestedEpoch`.
 * This root can be used to key that attester shuffling.
 *
 * Returns `null` on the one-off scenario where the genesis block decides its own shuffling.
 * It should be set to the latest block applied to this `state` or the genesis block root.
 */
export function attesterShufflingDecisionRoot(state: CachedBeaconStateAllForks, requestedEpoch: Epoch): Root | null {
  const decisionSlot = attesterShufflingDecisionSlot(state, requestedEpoch);
  if (state.slot === decisionSlot) {
    return null;
  }
  return getBlockRootAtSlot(state, decisionSlot);
}

/**
 * Returns the slot at which the proposer shuffling was decided. The block root at this slot
 * can be used to key the proposer shuffling for the current epoch.
 */
function attesterShufflingDecisionSlot(state: CachedBeaconStateAllForks, requestedEpoch: Epoch): Slot {
  const epoch = attesterShufflingDecisionEpoch(state, requestedEpoch);
  const slot = computeStartSlotAtEpoch(epoch);
  return Math.max(slot - 1, 0);
}

/**
 * Returns the epoch at which the attester shuffling was decided.
 *
 * Spec ref: https://github.com/ethereum/beacon-APIs/blob/v2.1.0/apis/validator/duties/attester.yaml#L15
 *
 * Throws an error when:
 * - `EpochTooLow` when `requestedEpoch` is more than 1 prior to `currentEpoch`.
 * - `EpochTooHigh` when `requestedEpoch` is more than 1 after `currentEpoch`.
 */
function attesterShufflingDecisionEpoch(state: CachedBeaconStateAllForks, requestedEpoch: Epoch): Epoch {
  const currentEpoch = state.epochCtx.epoch;

  // Next
  if (requestedEpoch === currentEpoch + 1) return currentEpoch;
  // Current
  if (requestedEpoch === currentEpoch) return Math.max(currentEpoch - 1, 0);
  // Previous
  if (requestedEpoch === currentEpoch - 1) return Math.max(currentEpoch - 2, 0);

  if (requestedEpoch < currentEpoch) {
    throw Error(`EpochTooLow: current ${currentEpoch} requested ${requestedEpoch}`);
  }
  throw Error(`EpochTooHigh: current ${currentEpoch} requested ${requestedEpoch}`);
}

// Copied from lodestar-api package to avoid depending on the package
export interface AttesterDuty {
  validatorIndex: ValidatorIndex;
  committeeIndex: CommitteeIndex;
  committeeLength: number;
  committeesAtSlot: number;
  validatorCommitteeIndex: number;
  slot: Slot;
}

export function calculateCommitteeAssignments(
  epochShuffling: EpochShuffling,
  requestedValidatorIndices: ValidatorIndex[]
): Map<ValidatorIndex, AttesterDuty> {
  const requestedValidatorIndicesSet = new Set(requestedValidatorIndices);
  const duties = new Map<ValidatorIndex, AttesterDuty>();

  const epochCommittees = epochShuffling.committees;
  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slotCommittees = epochCommittees[epochSlot];
    for (let i = 0, committeesAtSlot = slotCommittees.length; i < committeesAtSlot; i++) {
      for (let j = 0, committeeLength = slotCommittees[i].length; j < committeeLength; j++) {
        const validatorIndex = slotCommittees[i][j];
        if (requestedValidatorIndicesSet.has(validatorIndex)) {
          duties.set(validatorIndex, {
            validatorIndex,
            committeeLength,
            committeesAtSlot,
            validatorCommitteeIndex: j,
            committeeIndex: i,
            slot: epochShuffling.epoch * SLOTS_PER_EPOCH + epochSlot,
          });
        }
      }
    }
  }

  return duties;
}

/**
 * Return the indexed attestation corresponding to ``attestation``.
 */
export function getIndexedAttestation(
  epochShuffling: EpochShuffling,
  fork: ForkSeq,
  attestation: Attestation
): IndexedAttestation {
  const {data} = attestation;
  const attestingIndices = getAttestingIndices(epochShuffling, fork, attestation);

  // sort in-place
  attestingIndices.sort((a, b) => a - b);
  return {
    attestingIndices: attestingIndices,
    data: data,
    signature: attestation.signature,
  };
}

/**
 * Return indices of validators who attestested in `attestation`
 */
export function getAttestingIndices(epochShuffling: EpochShuffling, fork: ForkSeq, attestation: Attestation): number[] {
  if (fork < ForkSeq.electra) {
    const {aggregationBits, data} = attestation;
    const validatorIndices = getBeaconCommittee(epochShuffling, data.slot, data.index);

    return aggregationBits.intersectValues(validatorIndices);
  }
  const {aggregationBits, committeeBits, data} = attestation as electra.Attestation;

  // There is a naming conflict on the term `committeeIndices`
  // In Lodestar it usually means a list of validator indices of participants in a committee
  // In the spec it means a list of committee indices according to committeeBits
  // This `committeeIndices` refers to the latter
  // TODO Electra: resolve the naming conflicts
  const committeeIndices = committeeBits.getTrueBitIndexes();

  const validatorsByCommittee = getBeaconCommittees(epochShuffling, data.slot, committeeIndices);

  // Create a new Uint32Array to flatten `validatorsByCommittee`
  const totalLength = validatorsByCommittee.reduce((acc, curr) => acc + curr.length, 0);
  const committeeValidators = new Uint32Array(totalLength);

  let offset = 0;
  for (const committee of validatorsByCommittee) {
    committeeValidators.set(committee, offset);
    offset += committee.length;
  }

  return aggregationBits.intersectValues(committeeValidators);
}

/**
 * Return the beacon committee at slot for index.
 */
export function getBeaconCommittee(epochShuffling: EpochShuffling, slot: Slot, index: CommitteeIndex): Uint32Array {
  return getBeaconCommittees(epochShuffling, slot, [index])[0];
}

/**
 * Return a Uint32Array[] representing committees validator indices
 */
export function getBeaconCommittees(
  epochShuffling: EpochShuffling,
  slot: Slot,
  indices: CommitteeIndex[]
): Uint32Array[] {
  if (indices.length === 0) {
    throw new Error("Attempt to get committees without providing CommitteeIndex");
  }

  const slotCommittees = epochShuffling.committees[slot % SLOTS_PER_EPOCH];
  const committees = [];

  for (const index of indices) {
    if (index >= slotCommittees.length) {
      throw new ShufflingError({
        code: ShufflingErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
        index,
        maxIndex: slotCommittees.length,
      });
    }
    committees.push(slotCommittees[index]);
  }

  return committees;
}

export enum ShufflingErrorCode {
  COMMITTEE_INDEX_OUT_OF_RANGE = "SHUFFLING_ERROR_COMMITTEE_INDEX_OUT_OF_RANGE",
}

type ShufflingErrorType = {
  code: ShufflingErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE;
  index: number;
  maxIndex: number;
};

export class ShufflingError extends LodestarError<ShufflingErrorType> {}
