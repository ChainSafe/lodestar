import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {CachedBeaconStateAllForks, ISignatureSet, getBlockProposerSignatureSet} from "@lodestar/state-transition";
import {Root, SignedBeaconBlock, Slot, WithBytes, ssz} from "@lodestar/types";
import {IBlsVerifier} from "../../chain/bls/index.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";

export type BackfillBlockHeader = {
  slot: Slot;
  root: Root;
};

export type BackfillBlock = BackfillBlockHeader & {block: SignedBeaconBlock};

export function verifyBlockSequence(
  config: BeaconConfig,
  blocks: WithBytes<SignedBeaconBlock>[], // 12850304 to 12850273
  anchorRoot: Root
): {
  nextAnchor: BackfillBlock | null;
  verifiedBlocks: WithBytes<SignedBeaconBlock>[];
  error?: BackfillSyncErrorCode.NOT_LINEAR;
} {
  let nextRoot: Root = anchorRoot; // slot: 12850304
  let nextAnchor: BackfillBlock | null = null;

  const verifiedBlocks: WithBytes<SignedBeaconBlock>[] = [];
  let iteration = 0;
  for (const block of blocks.reverse()) {
    // 12850304 to 12850273
    // 12850273 to 12850304
    iteration++;
    const blockRoot = config.getForkTypes(block.data.message.slot).BeaconBlock.hashTreeRoot(block.data.message);
    // biome-ignore lint/suspicious/noConsole: testing
    console.log(
      "Iteration: ",
      iteration,
      "\nblockSlot:",
      block.data.message.slot,
      "\nblockRoot: ",
      blockRoot,
      blockRoot.buffer,
      "\nnextRoot: ",
      nextRoot,
      nextRoot.buffer,
      "\nanchorRoot: ",
      anchorRoot,
      anchorRoot.buffer
    );
    if (!ssz.Root.equals(blockRoot, nextRoot)) {
      if (ssz.Root.equals(nextRoot, anchorRoot)) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_ANCHORED});
      }
      return {nextAnchor, verifiedBlocks, error: BackfillSyncErrorCode.NOT_LINEAR};
    }
    verifiedBlocks.push(block);
    nextAnchor = {block: block.data, slot: block.data.message.slot, root: nextRoot};
    nextRoot = block.data.message.parentRoot;
  }
  return {nextAnchor, verifiedBlocks};
}

export async function verifyBlockProposerSignature(
  bls: IBlsVerifier,
  state: CachedBeaconStateAllForks,
  blocks: WithBytes<SignedBeaconBlock>[]
): Promise<void> {
  if (blocks.length === 1 && blocks[0].data.message.slot === GENESIS_SLOT) return;
  const signatures = blocks.reduce((sigs: ISignatureSet[], block) => {
    // genesis block doesn't have valid signature
    if (block.data.message.slot !== GENESIS_SLOT) sigs.push(getBlockProposerSignatureSet(state, block.data));
    return sigs;
  }, []);

  if (!(await bls.verifySignatureSets(signatures, {batchable: true}))) {
    throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
  }
}
