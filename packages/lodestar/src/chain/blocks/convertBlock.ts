import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockProcessJob} from "../chain";

/**
 * Convert incoming blocks to TreeBacked backing
 * The root is computed multiple times, the contents are hash-tree-rooted multiple times,
 * and some of the contents end up in the state as tree-form.
*/
export function convertBlock(
  config: IBeaconConfig
): (source: AsyncIterable<IBlockProcessJob>) => AsyncGenerator<IBlockProcessJob> {
  return (source) => {
    return (async function*() {
      for await (const job of source) {
        yield {
          ...job,
          signedBlock: config.types.SignedBeaconBlock.tree.createValue(job.signedBlock),
        };
      }
    })();
  };
}
