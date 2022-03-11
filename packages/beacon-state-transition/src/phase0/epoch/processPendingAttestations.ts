import {Epoch, phase0, ssz} from "@chainsafe/lodestar-types";
import {List, readonlyValues} from "@chainsafe/ssz";
import {CachedBeaconStatePhase0} from "../../types";
import {computeStartSlotAtEpoch, getBlockRootAtSlot, zipIndexesCommitteeBits} from "../../util";
import {IAttesterStatus} from "../../util/attesterStatus";

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
  attestations: List<phase0.PendingAttestation>,
  epoch: Epoch,
  sourceFlag: number,
  targetFlag: number,
  headFlag: number
): void {
  const {epochCtx, slot: stateSlot} = state;
  const rootType = ssz.Root;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  if (attestations.length === 0) {
    return;
  }
  const actualTargetBlockRoot = getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch));
  for (const att of readonlyValues(attestations)) {
    const aggregationBits = att.aggregationBits;
    const attData = att.data;
    const inclusionDelay = att.inclusionDelay;
    const proposerIndex = att.proposerIndex;
    const attSlot = attData.slot;
    const committeeIndex = attData.index;
    const attBeaconBlockRoot = attData.beaconBlockRoot;
    const attTarget = attData.target;
    const attVotedTargetRoot = rootType.equals(attTarget.root, actualTargetBlockRoot);
    const attVotedHeadRoot =
      attSlot < stateSlot && rootType.equals(attBeaconBlockRoot, getBlockRootAtSlot(state, attSlot));
    const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);
    const participants = zipIndexesCommitteeBits(committee, aggregationBits);

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
