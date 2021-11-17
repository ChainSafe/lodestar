import {P2pBlockResponse, phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {getSlotFromBytes} from "../../../util/multifork";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<P2pBlockResponse> {
  for (const blockRoot of requestBody) {
    const root = blockRoot.valueOf() as Uint8Array;
    const summary = chain.forkChoice.getBlock(root);
    let blockBytes: Buffer | null = null;
    // finalized block has summary in forkchoice but it stays in blockArchive db
    if (summary) {
      blockBytes = await db.block.getBinary(root);
    }
    if (!blockBytes) {
      blockBytes = await db.blockArchive.getBinaryByRoot(root);
    }
    if (blockBytes) {
      yield {
        bytes: blockBytes,
        slot: getSlotFromBytes(blockBytes),
      };
    }
  }
}
