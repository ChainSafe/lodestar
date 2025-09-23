import {randomBytes} from "node:crypto";
import {BYTES_PER_BLOB, BYTES_PER_FIELD_ELEMENT} from "@crate-crypto/node-eth-kzg";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {SIGNATURE_LENGTH_UNCOMPRESSED} from "@chainsafe/blst";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {
  ForkPostCapella,
  ForkPostDeneb,
  ForkPostFulu,
  NUMBER_OF_COLUMNS,
  SLOTS_PER_EPOCH,
  isForkPostDeneb,
  isForkPostFulu,
} from "@lodestar/params";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock, Slot, deneb, fulu, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {VersionedHashes} from "../../src/execution/index.js";
import {computeNodeIdFromPrivateKey} from "../../src/network/subnets/index.js";
import {getBlobSidecars, kzgCommitmentToVersionedHash} from "../../src/util/blobs.js";
import {Clock} from "../../src/util/clock.js";
import {CustodyConfig, computePostFuluKzgCommitmentsInclusionProof} from "../../src/util/dataColumns.js";
import {kzg} from "../../src/util/kzg.js";
import {ROOT_SIZE} from "../../src/util/sszBytes.js";

export const CAPELLA_FORK_EPOCH = 0;
export const DENEB_FORK_EPOCH = 10;
export const ELECTRA_FORK_EPOCH = 20;
export const FULU_FORK_EPOCH = 30;
export const GLOAS_FORK_EPOCH = 40;
export const config = createChainForkConfig({
  ...defaultChainConfig,
  CAPELLA_FORK_EPOCH,
  DENEB_FORK_EPOCH,
  ELECTRA_FORK_EPOCH,
  FULU_FORK_EPOCH,
  GLOAS_FORK_EPOCH,
});
export const clock = new Clock({
  config,
  // For our testing we want the clock to be at head of the latest fork
  genesisTime: Date.now() / 1000 - SLOTS_PER_EPOCH * GLOAS_FORK_EPOCH * config.SECONDS_PER_SLOT,
  signal: new AbortController().signal,
});
export const privateKey = await generateKeyPair("secp256k1");
export const nodeId = computeNodeIdFromPrivateKey(privateKey);
export const custodyConfig = new CustodyConfig({config, nodeId});

export const slots: Record<ForkPostCapella, number> = {
  capella: computeStartSlotAtEpoch(CAPELLA_FORK_EPOCH),
  deneb: computeStartSlotAtEpoch(DENEB_FORK_EPOCH),
  electra: computeStartSlotAtEpoch(ELECTRA_FORK_EPOCH),
  fulu: computeStartSlotAtEpoch(FULU_FORK_EPOCH),
  gloas: computeStartSlotAtEpoch(GLOAS_FORK_EPOCH),
};

/**
 * Value used in c-kzg
 * https://github.com/matthewkeil/c-kzg-4844/blob/cc7c4e90669efc777a92b375574036a64f8ae9ae/bindings/node.js/test/kzg.test.ts#L42
 */
const MAX_TOP_BYTE = 114;

/**
 * Generates a random blob of the correct length for the KZG library
 * https://github.com/matthewkeil/c-kzg-4844/blob/cc7c4e90669efc777a92b375574036a64f8ae9ae/bindings/node.js/test/kzg.test.ts#L87
 */
export function generateRandomBlob(): Uint8Array {
  return new Uint8Array(
    randomBytes(BYTES_PER_BLOB).map((x, i) => {
      // Set the top byte to be low enough that the field element doesn't overflow the BLS modulus
      if (x > MAX_TOP_BYTE && i % BYTES_PER_FIELD_ELEMENT === 0) {
        return Math.floor(Math.random() * MAX_TOP_BYTE);
      }
      return x;
    })
  );
}

/**
 * Generate a random number between min and max (inclusive)
 */
function generateRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function generateProposerIndex(min = 0, max = 100_000): number {
  return generateRandomInt(min, max);
}

export type GenerateBlockProps<F extends ForkPostCapella> = {
  forkName: F;
  slot?: Slot;
  parentRoot?: Uint8Array;
};

function generateBeaconBlock<F extends ForkPostCapella>({
  forkName,
  slot,
  parentRoot,
}: GenerateBlockProps<F>): SignedBeaconBlock<F> {
  const block = ssz[forkName].SignedBeaconBlock.defaultValue();
  block.message.slot = slot ? slot : slots[forkName];
  block.message.parentRoot = parentRoot ? parentRoot : Uint8Array.from(randomBytes(ROOT_SIZE));
  block.message.stateRoot = Uint8Array.from(randomBytes(ROOT_SIZE));
  block.message.proposerIndex = generateProposerIndex();
  // signature is obviously not valid so can generate it now instead of after commitments are attached
  block.signature = Uint8Array.from(randomBytes(SIGNATURE_LENGTH_UNCOMPRESSED));
  return block;
}

function generateRoots<F extends ForkPostCapella>(
  forkName: F,
  block: SignedBeaconBlock<F>
): {
  blockRoot: Uint8Array;
  rootHex: string;
} {
  const blockRoot = ssz[forkName].BeaconBlock.hashTreeRoot(block.message as any);
  const rootHex = toRootHex(blockRoot);
  return {
    blockRoot,
    rootHex,
  };
}

function generateBlobSidecars(
  block: SignedBeaconBlock<ForkPostDeneb>,
  count: number,
  oomProtection = false
): {
  block: SignedBeaconBlock<ForkPostDeneb>;
  blobSidecars: deneb.BlobSidecars;
  versionedHashes: VersionedHashes;
} {
  const blobs = Array.from({length: count}, () => generateRandomBlob());
  const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  const proofs = blobs.map((blob, i) => kzg.computeBlobKzgProof(blob, commitments[i]));

  block.message.body.blobKzgCommitments = commitments;

  const blobSidecars = getBlobSidecars(config, block, blobs, proofs);

  if (oomProtection) {
    blobSidecars.map((sidecar) => ({...sidecar, blob: new Uint8Array(1)}));
  }

  const versionedHashes = commitments.map((commitment) => kzgCommitmentToVersionedHash(commitment));

  return {
    block,
    blobSidecars,
    versionedHashes,
  };
}

function generateColumnSidecars<F extends ForkPostFulu>(
  forkName: F,
  block: SignedBeaconBlock<F>,
  numberOfBlobs: number,
  oomProtection = false,
  returnBlobs = false
): {
  block: SignedBeaconBlock<F>;
  columnSidecars: fulu.DataColumnSidecars;
  blobs?: deneb.Blob[];
} {
  const blobs = Array.from({length: numberOfBlobs}, () => generateRandomBlob());
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  block.message.body.blobKzgCommitments = kzgCommitments;

  const signedBlockHeader = signedBlockToSignedHeader(config, block);
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));
  const kzgCommitmentsInclusionProof = computePostFuluKzgCommitmentsInclusionProof(forkName, block.message.body);

  const columnSidecars = Array.from({length: NUMBER_OF_COLUMNS}, (_, columnIndex) => {
    const column = oomProtection
      ? []
      : Array.from({length: blobs.length}, (_, rowNumber) => cellsAndProofs[rowNumber].cells[columnIndex]);
    const kzgProofs = Array.from(
      {length: blobs.length},
      (_, rowNumber) => cellsAndProofs[rowNumber].proofs[columnIndex]
    );
    return {
      index: columnIndex,
      column,
      kzgCommitments,
      kzgProofs,
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    };
  });

  return {
    block,
    columnSidecars,
    blobs: returnBlobs ? blobs : undefined,
  };
}

export type BlockTestSet<F extends ForkPostCapella> = {
  block: SignedBeaconBlock<F>;
  blockRoot: Uint8Array;
  rootHex: string;
};

export function generateBlock<F extends ForkPostCapella>({
  forkName,
  parentRoot,
  slot,
}: GenerateBlockProps<F>): BlockTestSet<F> {
  const block = generateBeaconBlock({
    forkName,
    slot,
    parentRoot,
  });
  const {blockRoot, rootHex} = generateRoots(forkName, block);

  return {
    block,
    rootHex,
    blockRoot,
  };
}

export function generateChainOfBlocks<F extends ForkPostCapella>({
  forkName,
  count,
}: {
  forkName: F;
  count: number;
}): BlockTestSet<F>[] {
  let parentRoot: Uint8Array = Uint8Array.from(randomBytes(ROOT_SIZE));
  const startSlot = slots[forkName];
  const blocks: BlockTestSet<F>[] = [];
  for (let slot = startSlot; slot < startSlot + count; slot++) {
    const {block, blockRoot, rootHex} = generateBlock({forkName, parentRoot, slot});
    parentRoot = blockRoot;
    blocks.push({
      block,
      blockRoot,
      rootHex,
    });
  }
  return blocks;
}

export type BlockWithBlobsTestSet<F extends ForkPostDeneb> = BlockTestSet<F> & {
  blobSidecars: deneb.BlobSidecars;
  versionedHashes: VersionedHashes;
};

export type BlockWithColumnsTestSet<F extends ForkPostFulu> = BlockTestSet<F> & {
  columnSidecars: fulu.DataColumnSidecars;
  blobs?: deneb.Blob[];
};

export function generateBlockWithBlobSidecars<F extends ForkPostDeneb>({
  forkName,
  slot,
  count,
  parentRoot,
  oomProtection = false,
}: {
  forkName: F;
  parentRoot?: Uint8Array;
  count?: number;
  slot?: Slot;
  oomProtection?: boolean;
}): BlockWithBlobsTestSet<F> {
  const {block, blobSidecars, versionedHashes} = generateBlobSidecars(
    generateBeaconBlock({forkName, parentRoot, slot}),
    count ? count : generateRandomInt(1, 6),
    oomProtection
  );
  const {blockRoot, rootHex} = generateRoots(forkName, block);
  return {
    block,
    blobSidecars,
    blockRoot,
    rootHex,
    versionedHashes,
  };
}

export function generateBlockWithColumnSidecars<F extends ForkPostFulu>({
  forkName,
  slot,
  parentRoot,
  oomProtection = false,
  returnBlobs = false,
}: {
  forkName: F;
  parentRoot?: Uint8Array;
  slot?: Slot;
  oomProtection?: boolean;
  returnBlobs?: boolean;
}): BlockWithColumnsTestSet<F> {
  const {block, columnSidecars, blobs} = generateColumnSidecars(
    forkName,
    generateBeaconBlock({forkName, parentRoot, slot}),
    generateRandomInt(1, 6),
    oomProtection,
    returnBlobs
  );
  const {blockRoot, rootHex} = generateRoots(forkName, block);
  return {
    block,
    blockRoot,
    rootHex,
    columnSidecars,
    blobs: returnBlobs ? blobs : undefined,
  };
}

export type BlockWithSidecars<F extends ForkPostDeneb> = F extends ForkPostFulu
  ? BlockWithColumnsTestSet<ForkPostFulu>
  : BlockWithBlobsTestSet<ForkPostDeneb>;

export function generateChainOfBlocksWithBlobs<F extends ForkPostDeneb>({
  forkName,
  count,
  oomProtection = false,
}: {
  forkName: F;
  count: number;
  oomProtection?: boolean;
}): BlockWithSidecars<F>[] {
  let parentRoot: Uint8Array = Uint8Array.from(randomBytes(ROOT_SIZE));
  let slot = slots[forkName];
  const blocks: BlockWithSidecars<F>[] = [];
  for (; slot < slot + count; slot++) {
    const blockWithSidecars = (
      isForkPostFulu(forkName)
        ? generateBlockWithColumnSidecars<ForkPostFulu>({forkName, parentRoot, slot, oomProtection})
        : generateBlockWithBlobSidecars<ForkPostDeneb>({
            forkName,
            parentRoot,
            slot,
            oomProtection,
          })
    ) as BlockWithSidecars<F>;
    parentRoot = blockWithSidecars.blockRoot;
    blocks.push(blockWithSidecars);
  }
  return blocks;
}

export type ChainOfBlockMaybeSidecars<F extends ForkPostCapella> = F extends ForkPostDeneb
  ? BlockWithSidecars<F>[]
  : BlockTestSet<F>[];

export function generateChainOfBlockMaybeSidecars<F extends ForkPostCapella>({
  forkName,
  count,
  oomProtection = false,
}: {
  forkName: F;
  count: number;
  oomProtection?: boolean;
}): ChainOfBlockMaybeSidecars<F> {
  if (isForkPostDeneb(forkName)) {
    return generateChainOfBlocksWithBlobs({forkName, count, oomProtection}) as ChainOfBlockMaybeSidecars<F>;
  }
  return generateChainOfBlocks({forkName, count}) as ChainOfBlockMaybeSidecars<F>;
}
