import {Slot} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {SyncChain} from "../chain";

/**
 * Checks if a Finalized or Head chain should be removed
 */
export function shouldRemoveChain(syncChain: SyncChain, localFinalizedSlot: Slot, chain: IBeaconChain): boolean {
  return (
    // Sync chain has completed syncing or encountered an error
    syncChain.isRemovable ||
    // Sync chain has no more peers to download from
    syncChain.peers === 0 ||
    // Outdated: our chain has progressed beyond this sync chain
    syncChain.target.slot < localFinalizedSlot ||
    chain.forkChoice.hasBlock(syncChain.target.root)
  );
}
