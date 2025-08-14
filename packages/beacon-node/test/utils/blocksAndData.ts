import {randomBytes} from "node:crypto";
import {SIGNATURE_LENGTH_UNCOMPRESSED} from "@chainsafe/blst";
import {BYTES_PER_BLOB, BYTES_PER_FIELD_ELEMENT} from "@crate-crypto/node-eth-kzg";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {ChainForkConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkPostCapella, ForkPostDeneb, ForkPostFulu, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock, Slot, deneb, fulu, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {computeNodeIdFromPrivateKey} from "../../src/network/subnets/index.js";
import {computeInclusionProof} from "../../src/util/blobs.js";
import {CustodyConfig, getDataColumnSidecarsFromBlock} from "../../src/util/dataColumns.js";
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
export const privateKey = await generateKeyPair("secp256k1");
export const nodeId = computeNodeIdFromPrivateKey(privateKey);
export const custodyConfig = new CustodyConfig({config, nodeId});

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

function generateBeaconBlock({
  config,
  slot,
  parentRoot,
}: {config: ChainForkConfig; slot?: Slot; parentRoot?: Uint8Array}): SignedBeaconBlock {
  const block = config.getForkTypes(slot ?? 0).SignedBeaconBlock.defaultValue();
  block.message.slot = slot ? slot : 0;
  block.message.parentRoot = parentRoot ? parentRoot : Uint8Array.from(randomBytes(ROOT_SIZE));
  block.message.stateRoot = Uint8Array.from(randomBytes(ROOT_SIZE));
  block.message.proposerIndex = generateProposerIndex();
  block.signature = Uint8Array.from(randomBytes(SIGNATURE_LENGTH_UNCOMPRESSED));
  return block;
}

function generateRoots(
  config: ChainForkConfig,
  block: SignedBeaconBlock
): {
  blockRoot: Uint8Array;
  rootHex: string;
} {
  const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  const rootHex = toRootHex(blockRoot);
  return {
    blockRoot,
    rootHex,
  };
}

function generateBlobSidecars(
  config: ChainForkConfig,
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
    const blobSidecar = ssz.deneb.BlobSidecar.defaultValue();
    blobSidecar.index = index;
    blobSidecar.signedBlockHeader = signedBlockHeader;
    blobSidecar.blob = generateRandomBlob();
    blobSidecar.kzgCommitment = kzg.blobToKzgCommitment(blobSidecar.blob);
    blobSidecar.kzgCommitmentInclusionProof = computeInclusionProof(
      config.getForkName(block.message.slot),
      block.message.body,
      index
    );
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
  config: ChainForkConfig,
  block: SignedBeaconBlock<F>,
  numberOfBlobs: number
): {
  block: SignedBeaconBlock<F>;
  columnSidecars: fulu.DataColumnSidecars;
} {
  const blobs = Array.from({length: numberOfBlobs}, () => generateRandomBlob());
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  block.message.body.blobKzgCommitments = kzgCommitments;

  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));
  const columnSidecars = getDataColumnSidecarsFromBlock(config, block, cellsAndProofs);

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

export function generateChainOfBlocks({
  config,
  count,
}: {config: ChainForkConfig; count: number}): BlockTestSet<ForkPostCapella>[] {
  let parentRoot = Uint8Array.from(randomBytes(ROOT_SIZE));

  const blocks: BlockTestSet<ForkPostCapella>[] = [];
  for (let slot = 0; slot < count; slot++) {
    const block = generateBeaconBlock({config, parentRoot, slot});
    const {blockRoot, rootHex} = generateRoots(config, block);
    parentRoot = block.message.parentRoot;
    blocks.push({
      block: block as SignedBeaconBlock<ForkPostCapella>,
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

export function generateBlockWithBlobSidecars({
  config,
  slot,
  parentRoot,
}: {
  config: ChainForkConfig;
  parentRoot?: Uint8Array;
  slot?: Slot;
  oomProtection?: boolean;
}): BlockWithBlobsTestSet<ForkPostDeneb> {
  const {block, blobSidecars} = generateBlobSidecars(
    config,
    generateBeaconBlock({config, parentRoot, slot}) as SignedBeaconBlock<ForkPostDeneb>,
    generateRandomInt(1, 6)
  );
  const {blockRoot, rootHex} = generateRoots(config, block);
  return {
    block,
    blobSidecars,
    blockRoot,
    rootHex,
  };
}

export function generateBlockWithColumnSidecars({
  config,
  slot,
  parentRoot,
}: {
  config: ChainForkConfig;
  parentRoot?: Uint8Array;
  slot?: Slot;
  oomProtection?: boolean;
}): BlockWithColumnsTestSet<ForkPostFulu> {
  const {block, columnSidecars} = generateColumnSidecars(
    config,
    generateBeaconBlock({config, parentRoot, slot}) as SignedBeaconBlock<ForkPostFulu>,
    generateRandomInt(1, 6)
  );
  const {blockRoot, rootHex} = generateRoots(config, block);
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
  config,
  forkName,
  count,
  oomProtection = false,
}: {
  config: ChainForkConfig;
  forkName: F;
  count: number;
  oomProtection?: boolean;
}): BlocksWithSidecars<F> {
  let parentRoot = Uint8Array.from(randomBytes(ROOT_SIZE));
  let slot = slots[forkName];
  const blocks: BlocksWithSidecars<ForkPostDeneb> = [];
  for (; slot < slot + count; slot++) {
    const blockWithSidecars = isForkPostFulu(forkName)
      ? generateBlockWithColumnSidecars({config, parentRoot, slot, oomProtection})
      : generateBlockWithBlobSidecars({config, parentRoot, slot, oomProtection});
    parentRoot = blockWithSidecars.blockRoot;
    blocks.push(blockWithSidecars as any);
  }
  return blocks as BlocksWithSidecars<F>;
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
    return generateChainOfBlocksWithBlobs({config, forkName, count, oomProtection}) as ChainOfBlockMaybeSidecars<F>;
  }
  return generateChainOfBlocks({config, count}) as ChainOfBlockMaybeSidecars<F>;
}
