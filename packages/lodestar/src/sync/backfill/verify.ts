import {allForks, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, allForks as allForkTypes, ssz} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {IBlsVerifier} from "../../chain/bls";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors";

export function verifyBlockSequence(
  config: IBeaconConfig,
  blocks: allForkTypes.SignedBeaconBlock[],
  anchorRoot: Root
): void {
  let nextRoot: Root = anchorRoot;
  for (const block of blocks.slice(0).reverse()) {
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    if (!ssz.Root.equals(blockRoot, nextRoot)) {
      if (ssz.Root.equals(nextRoot, anchorRoot)) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_ANCHORED});
      }
      throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_LINEAR});
    }
    nextRoot = block.message.parentRoot;
  }
}

export async function verifyBlockProposerSignature(
  bls: IBlsVerifier,
  state: CachedBeaconState<allForks.BeaconState>,
  blocks: allForkTypes.SignedBeaconBlock[]
): Promise<void> {
  const signatures = blocks
    // genesis block doesn't have valid signature
    .filter((block) => block.message.slot !== GENESIS_SLOT)
    .map((block) => allForks.getProposerSignatureSet(state, block));

  if (!(await bls.verifySignatureSets(signatures))) {
    throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
  }
}
