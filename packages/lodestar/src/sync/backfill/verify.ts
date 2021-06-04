import {verifyBlockSignature} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";

export function verifyBlocks(config: IBeaconConfig, state: BeaconState, blocks: SignedBeaconBlock[]): void {
  if (blocks.length === 0) {
    return;
  }
  let lastBlock: SignedBeaconBlock | undefined;
  for (const block of blocks) {
    if (
      lastBlock &&
      !config.types.Root.equals(
        config.getForkTypes(lastBlock.message.slot).BeaconBlock.hashTreeRoot(lastBlock.message),
        block.message.parentRoot
      )
    ) {
      throw new Error("BackfillSync - Non linear blocks");
    }
    if (!verifyBlockSignature(config, state, block)) {
      throw new Error("BackfillSync - Invalid proposer signature");
    }
  }
}
