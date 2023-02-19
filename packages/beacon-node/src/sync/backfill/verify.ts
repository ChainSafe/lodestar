import {CachedBeaconStateAllForks, ISignatureSet, getProposerSignatureSet} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
import {allForks, Root, allForks as allForkTypes, ssz, Slot} from "@lodestar/types";
import {GENESIS_SLOT} from "@lodestar/params";
import {IBlsVerifier} from "../../chain/bls/index.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";

export type BackfillBlockHeader = {
  slot: Slot;
  root: Root;
};

export type BackfillBlock = BackfillBlockHeader & {block: allForks.SignedBeaconBlock};

export function verifyBlockSequence(
  config: BeaconConfig,
  blocks: allForkTypes.SignedBeaconBlock[],
  anchorRoot: Root
): {
  nextAnchor: BackfillBlock | null;
  verifiedBlocks: allForkTypes.SignedBeaconBlock[];
  error?: BackfillSyncErrorCode.NOT_LINEAR;
} {
  let nextRoot: Root = anchorRoot;
  let nextAnchor: BackfillBlock | null = null;

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
    nextAnchor = {block, slot: block.message.slot, root: nextRoot};
    nextRoot = block.message.parentRoot;
  }
  return {nextAnchor, verifiedBlocks};
}

export async function verifyBlockProposerSignature(
  bls: IBlsVerifier,
  state: CachedBeaconStateAllForks,
  blocks: allForkTypes.SignedBeaconBlock[]
): Promise<void> {
  if (blocks.length === 1 && blocks[0].message.slot === GENESIS_SLOT) return;
  const signatures = blocks.reduce((sigs: ISignatureSet[], block) => {
    // genesis block doesn't have valid signature
    if (block.message.slot !== GENESIS_SLOT) sigs.push(getProposerSignatureSet(state, block));
    return sigs;
  }, []);

  if (!(await bls.verifySignatureSets(signatures, {batchable: true}))) {
    throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
  }
}
