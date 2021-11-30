import {phase0, Slot} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";
import {getSlotFromBytes} from "../../../util/multifork";
import {ReqRespBlockResponse} from "../types";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ReqRespBlockResponse> {
  for (const blockRoot of requestBody) {
    const root = blockRoot.valueOf() as Uint8Array;
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
      yield {
        bytes: blockBytes,
        slot: slot ?? getSlotFromBytes(blockBytes),
      };
    }
  }
}
