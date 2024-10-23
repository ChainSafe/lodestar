import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {Slot} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {IStateDiffCodec, HistoricalStateStorageType, HierarchicalStateOperationOptions} from "../types.js";
import {replayBlocks} from "../utils/blockReplay.js";
import {XDelta3Codec} from "../utils/xdelta3.js";
import {getDiffStateArchive} from "../utils/diff.js";
import {stateArchiveToStateBytes} from "../utils/stateArchive.js";

export const codec: IStateDiffCodec = new XDelta3Codec();

export async function getHistoricalState(
  slot: Slot,
  {
    stateArchiveMode,
    db,
    logger,
    config,
    metrics,
    hierarchicalLayers,
    pubkey2index,
  }: HierarchicalStateOperationOptions & {pubkey2index: PubkeyIndexMap}
): Promise<Uint8Array | null> {
  const regenTimer = metrics?.regenTime.startTimer();
  const epoch = computeEpochAtSlot(slot);
  const slotType = hierarchicalLayers.getStorageType(slot, stateArchiveMode);
  logger.verbose("Fetching state archive", {slotType, slot, epoch});

  switch (slotType) {
    case HistoricalStateStorageType.Full: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      // It's a legacy format we use raw state as full object
      const state = await db.stateArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: HistoricalStateStorageType.Full});
      return state;
    }

    case HistoricalStateStorageType.Snapshot: {
      const loadStateTimer = metrics?.loadSnapshotStateTime.startTimer();
      const stateArchive = await db.stateArchive.get(slot);

      const state = stateArchive ? stateArchiveToStateBytes(stateArchive, config) : null;

      loadStateTimer?.();
      regenTimer?.({strategy: HistoricalStateStorageType.Snapshot});
      return state;
    }
    case HistoricalStateStorageType.Diff: {
      const {stateArchive} = await getDiffStateArchive(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );
      regenTimer?.({strategy: HistoricalStateStorageType.Diff});

      return stateArchive ? stateArchiveToStateBytes(stateArchive, config) : null;
    }
    case HistoricalStateStorageType.BlockReplay: {
      const {stateArchive, diffSlots} = await getDiffStateArchive(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, hierarchicalLayers: hierarchicalLayers, codec}
      );

      if (!stateArchive) {
        regenTimer?.({strategy: HistoricalStateStorageType.BlockReplay});
        return null;
      }

      const state = replayBlocks(
        {
          toSlot: slot,
          lastFullSlot: diffSlots[diffSlots.length - 1],
          lastFullStateBytes: stateArchiveToStateBytes(stateArchive, config),
        },
        {config, db, metrics, pubkey2index}
      );

      regenTimer?.({strategy: HistoricalStateStorageType.BlockReplay});

      return state;
    }
  }
}
