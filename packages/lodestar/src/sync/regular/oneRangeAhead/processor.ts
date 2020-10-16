import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";
import {IBeaconChain} from "../../../chain";
import {BlockError, BlockErrorCode} from "../../../chain/errors";
import {sortBlocks} from "../../utils";

/**
 * Process a block list until complete.
 */
export async function processUntilComplete(
  config: IBeaconConfig,
  chain: IBeaconChain,
  blocks: SignedBeaconBlock[],
  signal: AbortSignal
): Promise<void> {
  if (!blocks || !blocks.length) return;
  const sortedBlocks = sortBlocks(blocks);
  const lastRoot = config.types.BeaconBlock.hashTreeRoot(sortedBlocks[sortedBlocks.length - 1].message);
  sortedBlocks.forEach((block) => chain.receiveBlock(block, false));
  await new Promise((resolve) => {
    const onProcessedBlock = (signedBlock: SignedBeaconBlock): void => {
      if (signal.aborted) resolve();
      const root = config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
      if (config.types.Root.equals(root, lastRoot)) {
        chain.emitter.removeListener("block", onProcessedBlock);
        cleanUp();
        resolve();
      }
    };
    const onErrorBlock = async (err: BlockError): Promise<void> => {
      if (err.type.code === BlockErrorCode.ERR_BLOCK_IS_ALREADY_KNOWN) {
        await onProcessedBlock(err.job.signedBlock);
      }
    };
    const cleanUp = (): void => {
      chain.emitter.removeListener("block", onProcessedBlock);
      chain.emitter.removeListener("error:block", onErrorBlock);
    };
    chain.emitter.on("block", onProcessedBlock);
    chain.emitter.on("error:block", onErrorBlock);
  });
}
