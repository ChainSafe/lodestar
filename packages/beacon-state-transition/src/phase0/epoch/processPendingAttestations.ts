import {allForks, Epoch, phase0} from "@chainsafe/lodestar-types";
import {BitList, List, readonlyValues, TreeBacked} from "@chainsafe/ssz";
import {CachedBeaconState, IAttesterStatus} from "../../allForks/util";
import {computeStartSlotAtEpoch, getBlockRootAtSlot, zipIndexesInBitList} from "../../util";

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
    const attVotedTargetRoot = rootType.equals(attTarget.root, actualTargetBlockRoot);
    const attVotedHeadRoot = rootType.equals(attBeaconBlockRoot, getBlockRootAtSlot(config, state, attSlot));
    const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);
    const participants = zipIndexesInBitList(config, committee, aggregationBits as TreeBacked<BitList>);

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
