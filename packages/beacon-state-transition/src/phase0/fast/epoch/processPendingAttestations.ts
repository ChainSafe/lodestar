import {allForks, Epoch, phase0} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {BitList, List, readonlyValues, TreeBacked} from "@chainsafe/ssz";
import {CachedBeaconState, IAttesterStatus} from "../../../fast";
import {
  computeStartSlotAtEpoch,
  getAggregationBytes,
  getBlockRootAtSlot,
  PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY,
} from "../../../util";

export function statusProcessEpoch<T extends allForks.BeaconState>(
  state: CachedBeaconState<T>,
  statuses: IAttesterStatus[],
  attestations: List<phase0.PendingAttestation>,
  epoch: Epoch,
  sourceFlag: number,
  targetFlag: number,
  headFlag: number
): void {
  const {config, epochCtx} = state;
  const rootType = config.types.Root;
  const prevEpoch = epochCtx.previousShuffling.epoch;
  const actualTargetBlockRoot = getBlockRootAtSlot(config, state, computeStartSlotAtEpoch(config, epoch));
  for (const att of readonlyValues(attestations)) {
    const aggregationBits = att.aggregationBits;
    const attData = att.data;
    const inclusionDelay = att.inclusionDelay;
    const proposerIndex = att.proposerIndex;
    const attSlot = attData.slot;
    const committeeIndex = attData.index;
    const attBeaconBlockRoot = attData.beaconBlockRoot;
    const attTarget = attData.target;
    const attBytes = getAggregationBytes(config, aggregationBits as TreeBacked<BitList>);
    const attVotedTargetRoot = rootType.equals(attTarget.root, actualTargetBlockRoot);
    const attVotedHeadRoot = rootType.equals(attBeaconBlockRoot, getBlockRootAtSlot(config, state, attSlot));
    const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);
    const participants: phase0.ValidatorIndex[] = [];
    let booleansInByte: boolean[] = [];
    for (const [i, index] of committee.entries()) {
      const indexInByte = i % 8;
      if (indexInByte === 0) {
        const byte = attBytes[intDiv(i, 8)];
        booleansInByte = PRE_COMPUTED_BYTE_TO_BOOLEAN_ARRAY[byte];
      }
      // using (getAggregationBit(attBytes, i)) takes more time
      if (booleansInByte[indexInByte]) {
        participants.push(index);
      }
    }
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
