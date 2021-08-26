import {allForks, altair, Epoch, phase0, Root, Slot, ssz} from "@chainsafe/lodestar-types";
import {intSqrt} from "@chainsafe/lodestar-utils";

import {getBlockRoot, getBlockRootAtSlot, increaseBalance, verifySignatureSet} from "../../util";
import {CachedBeaconState, EpochContext} from "../../allForks/util";
import {IParticipationStatus} from "../../allForks/util/cachedEpochParticipation";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  MIN_ATTESTATION_INCLUSION_DELAY,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {checkpointToStr, validateAttestation} from "../../phase0/block/processAttestation";
import {BlockProcess} from "../../util/blockProcess";
import {getAttestationWithIndicesSignatureSet} from "../../allForks";

const PROPOSER_REWARD_DOMINATOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

export function processAttestations(
  state: CachedBeaconState<altair.BeaconState>,
  attestations: phase0.Attestation[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  blockProcess: BlockProcess,
  verifySignature = true
): void {
  const {epochCtx} = state;
  const stateSlot = state.slot;
  const rootCache = new RootCache(state);

  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  // Process all attestations first and then increase the balance of the proposer once
  let proposerReward = BigInt(0);
  for (const attestation of attestations) {
    const data = attestation.data;

    validateAttestation(state as CachedBeaconState<allForks.BeaconState>, attestation);

    // Retrieve the validator indices from the attestation participation bitfield
    const attestingIndices = epochCtx.getAttestingIndices(data, attestation.aggregationBits);

    // this check is done last because its the most expensive (if signature verification is toggled on)
    // TODO: Why should we verify an indexed attestation that we just created? If it's just for the signature
    // we can verify only that and nothing else.
    if (verifySignature) {
      const sigSet = getAttestationWithIndicesSignatureSet(
        state as CachedBeaconState<allForks.BeaconState>,
        attestation,
        attestingIndices
      );
      if (!verifySignatureSet(sigSet)) {
        throw new Error("Attestation signature is not valid");
      }
    }

    const epochParticipation =
      data.target.epoch === epochCtx.currentShuffling.epoch
        ? state.currentEpochParticipation
        : state.previousEpochParticipation;

    const {timelySource, timelyTarget, timelyHead} = getAttestationParticipationStatus(
      data,
      stateSlot - data.slot,
      rootCache,
      epochCtx
    );

    // For each participant, update their participation
    // In epoch processing, this participation info is used to calculate balance updates
    let totalBalancesWithWeight = BigInt(0);
    for (const index of attestingIndices) {
      const status = epochParticipation.getStatus(index) as IParticipationStatus;
      const newStatus = {
        timelySource: status.timelySource || timelySource,
        timelyTarget: status.timelyTarget || timelyTarget,
        timelyHead: status.timelyHead || timelyHead,
      };
      epochParticipation.setStatus(index, newStatus);
      /**
       * Spec:
       * baseReward = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT * baseRewardPerIncrement;
       * proposerRewardNumerator += baseReward * totalWeight
       */
      const totalWeight =
        BigInt(!status.timelySource && timelySource) * TIMELY_SOURCE_WEIGHT +
        BigInt(!status.timelyTarget && timelyTarget) * TIMELY_TARGET_WEIGHT +
        BigInt(!status.timelyHead && timelyHead) * TIMELY_HEAD_WEIGHT;

      if (totalWeight > 0) {
        // TODO: Cache effectiveBalance in a separate array
        // TODO: Consider using number instead of bigint for faster math
        totalBalancesWithWeight += validators[index].effectiveBalance * totalWeight;
      }
    }

    // Do the discrete math inside the loop to ensure a deterministic result
    const totalIncrements = totalBalancesWithWeight / EFFECTIVE_BALANCE_INCREMENT;
    const proposerRewardNumerator = totalIncrements * state.baseRewardPerIncrement;
    proposerReward += proposerRewardNumerator / PROPOSER_REWARD_DOMINATOR;
  }

  increaseBalance(state, epochCtx.getBeaconProposer(state.slot), proposerReward);
}

/**
 * https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.4/specs/altair/beacon-chain.md#get_attestation_participation_flag_indices
 */
export function getAttestationParticipationStatus(
  data: phase0.AttestationData,
  inclusionDelay: number,
  rootCache: RootCache,
  epochCtx: EpochContext
): IParticipationStatus {
  const justifiedCheckpoint =
    data.target.epoch === epochCtx.currentShuffling.epoch
      ? rootCache.currentJustifiedCheckpoint
      : rootCache.previousJustifiedCheckpoint;

  // The source and target votes are part of the FFG vote, the head vote is part of the fork choice vote
  // Both are tracked to properly incentivise validators
  //
  // The source vote always matches the justified checkpoint (else its invalid)
  // The target vote should match the most recent checkpoint (eg: the first root of the epoch)
  // The head vote should match the root at the attestation slot (eg: the root at data.slot)
  const isMatchingSource = ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      `Attestation source does not equal justified checkpoint: source=${checkpointToStr(
        data.source
      )} justifiedCheckpoint=${checkpointToStr(justifiedCheckpoint)}`
    );
  }
  const isMatchingTarget = ssz.Root.equals(data.target.root, rootCache.getBlockRoot(data.target.epoch));
  // a timely head is only be set if the target is _also_ matching
  const isMatchingHead =
    isMatchingTarget && ssz.Root.equals(data.beaconBlockRoot, rootCache.getBlockRootAtSlot(data.slot));
  return {
    timelySource: isMatchingSource && inclusionDelay <= intSqrt(SLOTS_PER_EPOCH),
    timelyTarget: isMatchingTarget && inclusionDelay <= SLOTS_PER_EPOCH,
    timelyHead: isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY,
  };
}

/**
 * Cache to prevent accessing the state tree to fetch block roots repeteadly.
 * In normal network conditions the same root is read multiple times, specially the target.
 */
export class RootCache {
  readonly currentJustifiedCheckpoint: altair.Checkpoint;
  readonly previousJustifiedCheckpoint: altair.Checkpoint;
  private readonly blockRootEpochCache = new Map<Epoch, Root>();
  private readonly blockRootSlotCache = new Map<Slot, Root>();

  constructor(private readonly state: CachedBeaconState<altair.BeaconState>) {
    this.currentJustifiedCheckpoint = state.currentJustifiedCheckpoint;
    this.previousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  }

  getBlockRoot(epoch: Epoch): Root {
    let root = this.blockRootEpochCache.get(epoch);
    if (!root) {
      root = getBlockRoot(this.state, epoch);
      this.blockRootEpochCache.set(epoch, root);
    }
    return root;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let root = this.blockRootSlotCache.get(slot);
    if (!root) {
      root = getBlockRootAtSlot(this.state, slot);
      this.blockRootSlotCache.set(slot, root);
    }
    return root;
  }
}
