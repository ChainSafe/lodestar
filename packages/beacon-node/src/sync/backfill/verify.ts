import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  Index2PubkeyCache,
  getBlockProposerSignatureSet,
} from "@lodestar/state-transition";
import {Root, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {IBlsVerifier} from "../../chain/bls/index.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";

export type BackfillBlockHeader = {
  slot: Slot;
  root: Root;
};

export type BackfillBlock = BackfillBlockHeader & {block: SignedBeaconBlock};

export function verifyBlockSequence(
  config: BeaconConfig,
  blocks: SignedBeaconBlock[],
  anchorRoot: Root
): {
  nextAnchor: BackfillBlock | null;
  verifiedBlocks: SignedBeaconBlock[];
  error?: BackfillSyncErrorCode.NOT_LINEAR;
} {
  let nextRoot: Root = anchorRoot;
  let nextAnchor: BackfillBlock | null = null;

  const verifiedBlocks: SignedBeaconBlock[] = [];
  for (const block of blocks.reverse()) {
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    if (!ssz.Root.equals(blockRoot, nextRoot)) {
      if (ssz.Root.equals(nextRoot, anchorRoot)) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_ANCHORED});
      }
      return {nextAnchor, verifiedBlocks, error: BackfillSyncErrorCode.NOT_LINEAR};
    }
    verifiedBlocks.push(block);
    nextAnchor = {block: block, slot: block.message.slot, root: nextRoot};
    nextRoot = block.message.parentRoot;
  }
  return {nextAnchor, verifiedBlocks};
}

export async function verifyBlockProposerSignature(
  index2pubkey: Index2PubkeyCache,
  bls: IBlsVerifier,
  state: CachedBeaconStateAllForks,
  blocks: SignedBeaconBlock[]
): Promise<void> {
  if (blocks.length === 1 && blocks[0].message.slot === GENESIS_SLOT) return;
  const signatures = blocks.reduce((sigs: ISignatureSet[], block) => {
    // genesis block doesn't have valid signature
    if (block.message.slot !== GENESIS_SLOT) sigs.push(getBlockProposerSignatureSet(index2pubkey, state, block));
    return sigs;
  }, []);

  if (!(await bls.verifySignatureSets(signatures, {batchable: true}))) {
    throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
  }
}
