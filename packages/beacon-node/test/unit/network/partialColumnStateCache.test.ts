import {BYTES_PER_BLOB} from "@crate-crypto/node-eth-kzg";
import {describe, expect, it, vi} from "vitest";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {KZG_COMMITMENTS_GINDEX} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PartialColumnStateCache} from "../../../src/network/partialColumnStateCache.js";
import {isFuluPartialDataColumnSidecar} from "../../../src/util/dataColumns.js";
import {kzg} from "../../../src/util/kzg.js";

describe("PartialColumnStateCache", () => {
  function createTestConfig() {
    return createChainForkConfig({
      ...defaultChainConfig,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: Infinity,
    });
  }

  function buildColumnSidecarFixture(chainConfig: ReturnType<typeof createTestConfig>): fulu.DataColumnSidecar {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;

    const blobs = [
      new Uint8Array(BYTES_PER_BLOB),
      new Uint8Array(BYTES_PER_BLOB).fill(1),
      new Uint8Array(BYTES_PER_BLOB).fill(2),
    ];
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    block.message.body.blobKzgCommitments = kzgCommitments;

    const signedBlockHeader = signedBlockToSignedHeader(chainConfig, block);
    const bodyView = ssz.fulu.BeaconBlockBody.toView(block.message.body);
    const kzgCommitmentsInclusionProof = new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
    const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

    return {
      index: 1,
      column: cellsAndProofs.map(({cells}) => cells[1]),
      kzgCommitments,
      kzgProofs: cellsAndProofs.map(({proofs}) => proofs[1]),
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    };
  }

  it("should merge partial cells and build request metadata for missing cells", () => {
    const chainConfig = createTestConfig();
    const fullColumn = buildColumnSidecarFixture(chainConfig);
    const cache = new PartialColumnStateCache();
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(fullColumn.signedBlockHeader.message));

    cache.upsertHeader(blockRootHex, {
      kzgCommitments: fullColumn.kzgCommitments,
      signedBlockHeader: fullColumn.signedBlockHeader,
      kzgCommitmentsInclusionProof: fullColumn.kzgCommitmentsInclusionProof,
    });

    const partialA: fulu.PartialDataColumnSidecar = {
      cellsPresentBitmap: BitArray.fromBoolArray([true, false, true]),
      partialColumn: [fullColumn.column[0], fullColumn.column[2]],
      kzgProofs: [fullColumn.kzgProofs[0], fullColumn.kzgProofs[2]],
      header: [],
    };

    expect(cache.storePartialSidecar(blockRootHex, fullColumn.index, partialA)).toBe(2);

    const mergedSidecar = cache.buildPartialSidecar(blockRootHex, fullColumn.index, {includeHeader: true});
    expect(mergedSidecar).not.toBeNull();
    if (mergedSidecar === null || !isFuluPartialDataColumnSidecar(mergedSidecar)) {
      expect.fail("Expected Fulu partial data column sidecar");
    }
    expect(mergedSidecar.cellsPresentBitmap.toBoolArray()).toEqual([true, false, true]);
    expect(mergedSidecar.partialColumn).toEqual([fullColumn.column[0], fullColumn.column[2]]);
    expect(mergedSidecar.header).toHaveLength(1);

    const metadataBytes = cache.buildPartsMetadataBytes(blockRootHex, fullColumn.index);
    expect(metadataBytes).not.toBeNull();

    const metadata = ssz.fulu.PartialDataColumnPartsMetadata.deserialize(metadataBytes ?? new Uint8Array());
    expect(metadata.available.toBoolArray()).toEqual([true, false, true]);
    expect(metadata.requests.toBoolArray()).toEqual([false, true, false]);
  });

  it("should store full columns and remember peers that already have the header", () => {
    const chainConfig = createTestConfig();
    const fullColumn = buildColumnSidecarFixture(chainConfig);
    const cache = new PartialColumnStateCache();
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(fullColumn.signedBlockHeader.message));

    expect(cache.storeFullColumn(fullColumn)).toBe(fullColumn.column.length);

    cache.markPeerHasHeader(blockRootHex, "peer-a");

    expect(cache.hasPeerWithHeader(blockRootHex, "peer-a")).toBe(true);
    expect(cache.getSlot(blockRootHex)).toBe(fullColumn.signedBlockHeader.message.slot);

    const sidecar = cache.buildPartialSidecar(blockRootHex, fullColumn.index, {includeHeader: false});
    expect(sidecar?.cellsPresentBitmap.toBoolArray()).toEqual([true, true, true]);
    expect(sidecar?.partialColumn).toEqual(fullColumn.column);
  });

  it("should prune old block entries once the cache exceeds its max size", () => {
    const chainConfig = createTestConfig();
    const onPrune = vi.fn();
    const cache = new PartialColumnStateCache({maxBlocks: 1, onPrune});
    const firstColumn = buildColumnSidecarFixture(chainConfig);
    const secondColumn = buildColumnSidecarFixture(chainConfig);
    secondColumn.signedBlockHeader.message.slot = 2;

    const firstRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(firstColumn.signedBlockHeader.message));
    const secondRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(secondColumn.signedBlockHeader.message));

    cache.storeFullColumn(firstColumn);
    cache.storeFullColumn(secondColumn);

    expect(cache.getBlockCount()).toBe(1);
    expect(cache.hasBlock(firstRootHex)).toBe(false);
    expect(cache.hasBlock(secondRootHex)).toBe(true);
    expect(onPrune).toHaveBeenCalledWith(1);
  });
});
