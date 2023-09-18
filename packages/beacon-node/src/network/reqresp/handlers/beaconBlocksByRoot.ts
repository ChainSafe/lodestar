import {toHexString} from "@chainsafe/ssz";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {Slot, phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";

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
          throw Error(`Invalid block bytes for block root ${toHexString(root)}`);
        }
        slot = slotFromBytes;
      }

      // TODO: (matthewkeil)
      // It's a bis sus that deleting this line will still let the code compile..
      // This code MUST include tests to ensure ReqResp works with full or blinded blocks
      const {name, seq} = chain.config.getForkInfo(slot);
      const chunks: Uint8Array[] = [];
      for await (const chunk of chain.blindedOrFullBlockToFullBytes(seq, blockBytes)) {
        chunks.push(chunk);
      }

      yield {
        data: Buffer.concat(chunks),
        fork: name,
      };
    }
  }
}
