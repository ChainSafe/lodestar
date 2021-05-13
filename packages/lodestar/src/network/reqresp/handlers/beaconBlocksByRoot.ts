import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<allForks.SignedBeaconBlock> {
  for (const blockRoot of requestBody) {
    const root = blockRoot.valueOf() as Uint8Array;
    const summary = chain.forkChoice.getBlock(root);
    const block = summary ? await db.block.get(root) : await db.blockArchive.getByRoot(root);
    if (block) {
      yield block;
    }
  }
}
