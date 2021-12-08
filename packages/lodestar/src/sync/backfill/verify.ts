import {allForks, CachedBeaconState, ISignatureSet} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, allForks as allForkTypes, ssz} from "@chainsafe/lodestar-types";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {IBlsVerifier} from "../../chain/bls";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors";

export function verifyBlockSequence(
  config: IBeaconConfig,
  blocks: allForkTypes.SignedBeaconBlock[],
  anchorRoot: Root
): {
  nextAnchor: allForkTypes.SignedBeaconBlock | null;
  verifiedBlocks: allForkTypes.SignedBeaconBlock[];
  error?: BackfillSyncErrorCode.NOT_LINEAR;
} {
  let nextRoot: Root = anchorRoot;
  let nextAnchor: allForkTypes.SignedBeaconBlock | null = null;

  const verifiedBlocks: allForkTypes.SignedBeaconBlock[] = [];
  for (const block of blocks.reverse()) {
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    if (!ssz.Root.equals(blockRoot, nextRoot)) {
      if (ssz.Root.equals(nextRoot, anchorRoot)) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_ANCHORED});
      }
      return {nextAnchor, verifiedBlocks, error: BackfillSyncErrorCode.NOT_LINEAR};
    }
    verifiedBlocks.push(block);
    nextRoot = block.message.parentRoot;
    nextAnchor = block;
  }
  return {nextAnchor, verifiedBlocks};
}

export async function verifyBlockProposerSignature(
  bls: IBlsVerifier,
  state: CachedBeaconState<allForks.BeaconState>,
  blocks: allForkTypes.SignedBeaconBlock[]
): Promise<void> {
  const signatures = blocks.reduce((sigs: ISignatureSet[], block) => {
    // genesis block doesn't have valid signature
    if (block.message.slot !== GENESIS_SLOT) sigs.push(allForks.getProposerSignatureSet(state, block));
    return sigs;
  }, []);

  if (!(await bls.verifySignatureSets(signatures))) {
    throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
  }
}
