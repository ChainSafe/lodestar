import {ResponseOutgoing} from "@lodestar/reqresp";
import {Slot, phase0} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";
import {deserializeFullOrBlindedSignedBeaconBlock} from "../../../util/fullOrBlindedBlock.js";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
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

      const block = await chain.fullOrBlindedSignedBeaconBlockToFull(
        deserializeFullOrBlindedSignedBeaconBlock(chain.config, blockBytes)
      );
      yield {
        data: chain.config.getForkTypes(slot).SignedBeaconBlock.serialize(block),
        fork: chain.config.getForkName(slot),
      };
    }
  }
}
