import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";
import {BeaconBlocksByRootRequest} from "../../../util/types.js";

export async function* onBeaconBlocksByRoot(
  requestBody: BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  for (const blockRoot of requestBody) {
    const root = blockRoot;
    const summary = chain.forkChoice.getBlock(root);
    let blockBytes: Uint8Array | null = null;

    // finalized block has summary in forkchoice but it stays in blockArchive db
    if (summary) {
      blockBytes = await db.block.getBinary(root);
    }

    let slot: Slot | undefined = undefined;
    if (!blockBytes) {
      const blockEntry = await db.blockArchive.getBinaryEntryByRoot(root);
      if (blockEntry) {
        slot = blockEntry.key;
        blockBytes = blockEntry.value;
      }
    }

    if (blockBytes) {
      if (slot === undefined) {
        const slotFromBytes = getSlotFromSignedBeaconBlockSerialized(blockBytes);
        if (slotFromBytes === null) {
          throw Error(`Invalid block bytes for block root ${toRootHex(root)}`);
        }
        slot = slotFromBytes;
      }

      yield {
        data: blockBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    }
  }
}
