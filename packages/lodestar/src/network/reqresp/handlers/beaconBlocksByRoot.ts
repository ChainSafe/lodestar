import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<phase0.SignedBeaconBlock> {
  const getBlock = db.block.get.bind(db.block);
  const getFinalizedBlock = db.blockArchive.getByRoot.bind(db.blockArchive);
  for (const blockRoot of requestBody) {
    const root = blockRoot.valueOf() as Uint8Array;
    const summary = chain.forkChoice.getBlock(root);
    const block = summary ? await getBlock(root) : await getFinalizedBlock(root);
    if (block) {
      yield block;
    }
  }
}
