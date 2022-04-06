import {Epoch, phase0} from "@chainsafe/lodestar-types";
import {byteArrayEquals} from "@chainsafe/ssz";
import {CachedBeaconStatePhase0} from "../../types.js";
import {computeStartSlotAtEpoch, getBlockRootAtSlot, IAttesterStatus} from "../../util/index.js";

/**
 * Mutates `statuses` from all pending attestations.
 *
 * PERF: Cost 'proportional' to attestation count + how many bits per attestation + how many flags the attestation triggers
 *
 * - On normal mainnet conditions:
 *   - previousEpochAttestations: 3403
 *   - currentEpochAttestations:  3129
 *   - previousEpochAttestationsBits: 83
 *   - currentEpochAttestationsBits:  85
 */
export function statusProcessEpoch(
  state: CachedBeaconStatePhase0,
  statuses: IAttesterStatus[],
  attestations: phase0.PendingAttestation[],
  epoch: Epoch,
  sourceFlag: number,
  targetFlag: number,
  headFlag: number
): void {
  const {epochCtx, slot: stateSlot} = state;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  if (attestations.length === 0) {
    return;
  }

  // Prevent frequent object get of external CommonJS dependencies
  const byteArrayEqualsFn = byteArrayEquals;

  const actualTargetBlockRoot = getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch));

  for (const att of attestations) {
    // Ignore empty BitArray, from spec test minimal/phase0/epoch_processing/participation_record_updates updated_participation_record
    // See https://github.com/ethereum/consensus-specs/issues/2825
    if (att.aggregationBits.bitLen === 0) {
      continue;
    }

    const attData = att.data;
    const inclusionDelay = att.inclusionDelay;
    const proposerIndex = att.proposerIndex;
    const attSlot = attData.slot;
    const attVotedTargetRoot = byteArrayEqualsFn(attData.target.root, actualTargetBlockRoot);
    const attVotedHeadRoot =
      attSlot < stateSlot && byteArrayEqualsFn(attData.beaconBlockRoot, getBlockRootAtSlot(state, attSlot));
    const committee = epochCtx.getBeaconCommittee(attSlot, attData.index);
    const participants = att.aggregationBits.intersectValues(committee);

    if (epoch === prevEpoch) {
      for (const p of participants) {
        const status = statuses[p];
        if (status.proposerIndex === -1 || status.inclusionDelay > inclusionDelay) {
          status.proposerIndex = proposerIndex;
          status.inclusionDelay = inclusionDelay;
        }
      }
    }

    for (const p of participants) {
      const status = statuses[p];
      status.flags |= sourceFlag;
      if (attVotedTargetRoot) {
        status.flags |= targetFlag;
        if (attVotedHeadRoot) {
          status.flags |= headFlag;
        }
      }
    }
  }
}
