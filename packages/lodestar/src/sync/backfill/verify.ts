import {allForks, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {Root} from "../../../../types/lib";
import {IBlsVerifier} from "../../chain/bls";

export async function verifyBlocks(
  config: IBeaconConfig,
  bls: IBlsVerifier,
  state: CachedBeaconState<allForks.BeaconState>,
  blocks: SignedBeaconBlock[],
  anchorRoot: Root
): Promise<void> {
  if (blocks.length === 0) {
    return;
  }
  const nextRoot: Root = anchorRoot;
  const signatures: ReturnType<typeof allForks["getProposerSignatureSet"]>[] = [];
  for (const block of blocks.reverse()) {
    if (
      !config.types.Root.equals(
        config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
        nextRoot
      )
    ) {
      throw new Error("BackfillSync - Non linear blocks");
    }
    signatures.push(allForks.getProposerSignatureSet(state, block));
  }
  if (!(await bls.verifySignatureSets(signatures))) {
    throw new Error("BackfillSync - Proposer signature invalid");
  }
}
