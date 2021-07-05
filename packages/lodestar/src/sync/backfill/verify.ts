import {allForks, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {Root} from "../../../../types/lib";
import {IBlsVerifier} from "../../chain/bls";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors";

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
  for (const block of blocks.reverse()) {
    if (
      !config.types.Root.equals(
        config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
        nextRoot
      )
    ) {
      if (config.types.Root.equals(nextRoot, anchorRoot)) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_ANCHORED});
      }
      throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_LINEAR});
    }
  }
  const signatures = blocks.map((block) => allForks.getProposerSignatureSet(state, block));
  if (!(await bls.verifySignatureSets(signatures))) {
    throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
  }
}
