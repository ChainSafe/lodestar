import {randomBytes} from "node:crypto";
import {SIGNATURE_LENGTH_UNCOMPRESSED} from "@chainsafe/blst";
import {
  BYTES_PER_BLOB,
  BYTES_PER_COMMITMENT,
  BYTES_PER_FIELD_ELEMENT,
  BYTES_PER_PROOF,
} from "@crate-crypto/node-eth-kzg";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {
  ForkName,
  ForkPostCapella,
  ForkPostDeneb,
  ForkPostFulu,
  NUMBER_OF_COLUMNS,
  isForkPostDeneb,
  isForkPostFulu,
} from "@lodestar/params";
import {
  blindedOrFullBlockToHeader,
  blockToHeader,
  computeStartSlotAtEpoch,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {BeaconBlock, SignedBeaconBlock, Slot, deneb, fulu, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {VersionedHashes} from "../../src/execution/index.js";
import {
  computeInclusionProof,
  computeKzgCommitmentsInclusionProof,
  kzgCommitmentToVersionedHash,
} from "../../src/util/blobs.js";
import {kzg} from "../../src/util/kzg.js";
import {ROOT_SIZE} from "../../src/util/sszBytes.js";

export const CAPELLA_FORK_EPOCH = 0;
export const DENEB_FORK_EPOCH = 10;
export const ELECTRA_FORK_EPOCH = 20;
export const FULU_FORK_EPOCH = 30;
export const config = createChainForkConfig({
  ...defaultChainConfig,
  CAPELLA_FORK_EPOCH,
  DENEB_FORK_EPOCH,
  ELECTRA_FORK_EPOCH,
  FULU_FORK_EPOCH,
});

export const slots: Record<ForkPostCapella, number> = {
  capella: computeStartSlotAtEpoch(CAPELLA_FORK_EPOCH),
  deneb: computeStartSlotAtEpoch(DENEB_FORK_EPOCH),
  electra: computeStartSlotAtEpoch(ELECTRA_FORK_EPOCH),
  fulu: computeStartSlotAtEpoch(FULU_FORK_EPOCH),
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
  return generateRandomInt(max, min);
}

function generateBeaconBlock<F extends ForkPostCapella>({
  forkName,
  slot,
  parentRoot,
}: {forkName: F; slot?: Slot; parentRoot?: Uint8Array}): SignedBeaconBlock<F> {
  const block = ssz[forkName].SignedBeaconBlock.defaultValue();
  block.message.slot = slot ? slot : slots[forkName];
  block.message.parentRoot = parentRoot ? parentRoot : Uint8Array.from(randomBytes(ROOT_SIZE));
  block.message.stateRoot = Uint8Array.from(randomBytes(ROOT_SIZE));
  block.message.proposerIndex = generateProposerIndex();
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
  const blockRoot = ssz[forkName].BeaconBlock.hashTreeRoot(block.message);
  const rootHex = toRootHex(blockRoot);
  const signed = ssz[forkName].SignedBeaconBlock.defaultValue();
  return {
    block: signed,
    blockRoot,
    rootHex,
  };
}

function generateBlobSidecars(
  forkName: ForkPostDeneb,
  block: SignedBeaconBlock<ForkPostDeneb>,
  count: number,
  oomProtection = false
): {
  block: SignedBeaconBlock<ForkPostDeneb>;
  blobSidecars: deneb.BlobSidecars;
  // versionedHashes: VersionedHashes
} {
  const blobKzgCommitments: Uint8Array[] = [];
  const blobSidecars: deneb.BlobSidecars = [];
  const signedBlockHeader = signedBlockToSignedHeader(config, block);

  for (let index = 0; index < count; index++) {
    const blobSidecar = ssz[forkName].BlobSidecar.defaultValue();
    blobSidecar.index = index;
    blobSidecar.signedBlockHeader = signedBlockHeader;
    blobSidecar.blob = generateRandomBlob(index);
    blobSidecar.kzgCommitment = kzg.blobToKzgCommitment(blobSidecar.blob);
    blobSidecar.kzgCommitmentInclusionProof = computeInclusionProof(forkName, block.message.body, index);
    blobSidecar.kzgProof = kzg.computeBlobKzgProof(blobSidecar.blob, blobSidecar.kzgCommitment);

    if (oomProtection) {
      blobSidecar.blob = new Uint8Array(1);
    }

    blobSidecars.push(blobSidecar);
    blobKzgCommitments.push(blobSidecar.kzgCommitment);
  }

  block.message.body.blobKzgCommitments = blobKzgCommitments;
  // const versionedHashes = blobKzgCommitments.map((commitment) => kzgCommitmentToVersionedHash(commitment));

  return {
    block,
    blobSidecars,
    // versionedHashes,
  };
}

function generateColumnSidecars<F extends ForkPostFulu>(
  forkName: F,
  block: SignedBeaconBlock<F>,
  numberOfBlobs: number,
  oomProtection = false
): {
  block: SignedBeaconBlock<F>;
  columnSidecars: fulu.DataColumnSidecars;
} {
  const blobs = Array.from({length: numberOfBlobs}, () => generateRandomBlob());
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  block.body.blobKzgCommitments = kzgCommitments;

  const signedBlockHeader = signedBlockToSignedHeader(config, block);
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));
  const kzgCommitmentsInclusionProof = Array.from({length: blobs.length}, () =>
    computeKzgCommitmentsInclusionProof(forkName, block.body)
  );

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
  };
}

export type BlockTestSet<F extends ForkPostCapella> = {
  block: SignedBeaconBlock<F>;
  blockRoot: Uint8Array;
  rootHex: string;
};

export function generateChainOfBlocks<F extends ForkPostCapella>({
  forkName,
  count,
}: {forkName: F; count: number}): BlockTestSet<F>[] {
  let parentRoot = Uint8Array.from(randomBytes(ROOT_SIZE));
  let slot = slots[forkName];
  const blocks: BlockTestSet<F>[] = [];
  for (; slot < slot + count; slot++) {
    const block = generateBeaconBlock({forkName, parentRoot, slot});
    const {blockRoot, rootHex} = generateRoots(forkName, block);
    parentRoot = block.message.parentRoot;
    blocks.push({
      block,
      blockRoot,
      rootHex,
    });
  }
  return blocks;
}

export type BlockWithBlobsTestSet<F extends ForkPostDeneb> = BlockTestSet<F> & {blobSidecars: deneb.BlobSidecars};

export type BlockWithColumnsTestSet<F extends ForkPostFulu> = BlockTestSet<F> & {
  columnSidecars: fulu.DataColumnSidecars;
};

export function generateBlockWithBlobSidecars<F extends ForkPostDeneb>({
  forkName,
  slot,
  parentRoot,
  oomProtection = false,
}: {
  forkName: F;
  parentRoot?: Uint8Array;
  slot?: Slot;
  oomProtection?: boolean;
}): BlockWithBlobsTestSet<F> {
  const {block, blobSidecars} = generateBlobSidecars(
    forkName,
    generateBeaconBlock({forkName, parentRoot, slot}),
    generateRandomInt(1, 6)
  );
  const {blockRoot, rootHex} = generateRoots(forkName, block);
  return {
    block,
    blobSidecars,
    blockRoot,
    rootHex,
  };
}

export function generateBlockWithColumnSidecars<F extends ForkPostFulu>({
  forkName,
  slot,
  parentRoot,
  oomProtection = false,
}: {
  forkName: F;
  parentRoot?: Uint8Array;
  slot?: Slot;
  oomProtection?: boolean;
}): BlockWithColumnsTestSet<F> {
  const {block, columnSidecars} = generateColumnSidecars(
    forkName,
    generateBeaconBlock({forkName, parentRoot, slot}),
    generateRandomInt(1, 6)
  );
  const {blockRoot, rootHex} = generateRoots(forkName, block);
  return {
    block,
    columnSidecars,
    blockRoot,
    rootHex,
  };
}

export type BlocksWithSidecars<F extends ForkPostDeneb> = F extends ForkPostFulu
  ? BlockWithColumnsTestSet<F>[]
  : BlockWithBlobsTestSet<F>[];
export function generateChainOfBlocksWithBlobs<F extends ForkPostDeneb>({
  forkName,
  count,
  oomProtection = false,
}: {
  forkName: F;
  count: number;
  oomProtection?: boolean;
}): BlocksWithSidecars<F> {
  let parentRoot = Uint8Array.from(randomBytes(ROOT_SIZE));
  let slot = slots[forkName];
  const blocks: BlocksWithSidecars<F> = [];
  for (; slot < slot + count; slot++) {
    const blockWithSidecars = isForkPostFulu(forkName)
      ? generateBlockWithColumnSidecars({forkName, parentRoot, slot, oomProtection})
      : generateBlockWithBlobSidecars({forkName, parentRoot, slot, oomProtection});
    parentRoot = blockWithSidecars.blockRoot;
    blocks.push(blockWithSidecars);
  }
  return blocks;
}

export type ChainOfBlockMaybeSidecars<F extends ForkPostCapella> = F extends ForkPostFulu
  ? BlockWithColumnsTestSet<F>[]
  : F extends ForkPostDeneb
    ? BlockWithBlobsTestSet<F>[]
    : BlockTestSet<F>[];
export function generateChainOfBlockMaybeSidecars<F extends ForkPostCapella>(
  forkName: F,
  count: number,
  oomProtection = false
): ChainOfBlockMaybeSidecars<F> {
  if (isForkPostDeneb(forkName)) {
    return generateChainOfBlocksWithBlobs({forkName, count, oomProtection});
  }
  return generateChainOfBlocks({forkName, count});
}
