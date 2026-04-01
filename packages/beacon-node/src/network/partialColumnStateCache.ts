import {BitArray} from "@chainsafe/ssz";
import {RootHex, SubnetID, fulu, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {PeerIdStr} from "../util/peerId.js";
import {buildPartsMetadataBytes} from "../util/dataColumns.js";

const DEFAULT_MAX_BLOCKS = 64;

type CellWithProof = {
  cell: Uint8Array;
  proof: Uint8Array;
};

type PartialColumnData = {
  bitLen: number;
  cells: Map<number, CellWithProof>;
};

type PartialBlockState = {
  header: fulu.PartialDataColumnHeader;
  slot: number;
  columns: Map<SubnetID, PartialColumnData>;
  peersWithHeader: Set<PeerIdStr>;
};

export class PartialColumnStateCache {
  private readonly blocks = new Map<RootHex, PartialBlockState>();

  constructor(private readonly maxBlocks = DEFAULT_MAX_BLOCKS) {}

  upsertHeader(blockRootHex: RootHex, header: fulu.PartialDataColumnHeader): void {
    const existing = this.blocks.get(blockRootHex);
    if (existing !== undefined) {
      const existingRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(existing.header.signedBlockHeader.message);
      const incomingRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header.signedBlockHeader.message);
      if (!byteArrayEquals(existingRoot, incomingRoot)) {
        throw Error("PartialColumnStateCache header mismatch");
      }
      this.touch(blockRootHex, existing);
      return;
    }

    this.blocks.set(blockRootHex, {
      header,
      slot: header.signedBlockHeader.message.slot,
      columns: new Map(),
      peersWithHeader: new Set(),
    });
    this.prune();
  }

  markPeerHasHeader(blockRootHex: RootHex, peerId: PeerIdStr): void {
    const state = this.blocks.get(blockRootHex);
    if (state === undefined) {
      return;
    }

    state.peersWithHeader.add(peerId);
    this.touch(blockRootHex, state);
  }

  hasPeerWithHeader(blockRootHex: RootHex, peerId: PeerIdStr): boolean {
    return this.blocks.get(blockRootHex)?.peersWithHeader.has(peerId) ?? false;
  }

  getSlot(blockRootHex: RootHex): number | null {
    return this.blocks.get(blockRootHex)?.slot ?? null;
  }

  hasBlock(blockRootHex: RootHex): boolean {
    return this.blocks.has(blockRootHex);
  }

  storePartialSidecar(blockRootHex: RootHex, subnet: SubnetID, sidecar: fulu.PartialDataColumnSidecar): number {
    if (sidecar.header.length > 0) {
      this.upsertHeader(blockRootHex, sidecar.header[0]);
    }

    const state = this.blocks.get(blockRootHex);
    if (state === undefined) {
      return 0;
    }

    const bitLen = state.header.kzgCommitments.length;
    const column = this.getOrCreateColumn(state, subnet, bitLen);
    let addedCells = 0;
    let cellIndex = 0;

    for (let i = 0; i < sidecar.cellsPresentBitmap.bitLen; i++) {
      if (!sidecar.cellsPresentBitmap.get(i)) {
        continue;
      }

      if (!column.cells.has(i)) {
        column.cells.set(i, {
          cell: sidecar.partialColumn[cellIndex],
          proof: sidecar.kzgProofs[cellIndex],
        });
        addedCells++;
      }
      cellIndex++;
    }

    this.touch(blockRootHex, state);
    return addedCells;
  }

  storeFullColumn(column: fulu.DataColumnSidecar): number {
    const header: fulu.PartialDataColumnHeader = {
      kzgCommitments: column.kzgCommitments,
      signedBlockHeader: column.signedBlockHeader,
      kzgCommitmentsInclusionProof: column.kzgCommitmentsInclusionProof,
    };
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(column.signedBlockHeader.message));

    this.upsertHeader(blockRootHex, header);

    const state = this.blocks.get(blockRootHex);
    if (state === undefined) {
      return 0;
    }

    const columnState = this.getOrCreateColumn(state, column.index, column.column.length);
    let addedCells = 0;

    for (let i = 0; i < column.column.length; i++) {
      if (!columnState.cells.has(i)) {
        columnState.cells.set(i, {cell: column.column[i], proof: column.kzgProofs[i]});
        addedCells++;
      }
    }

    this.touch(blockRootHex, state);
    return addedCells;
  }

  buildPartialSidecar(
    blockRootHex: RootHex,
    subnet: SubnetID,
    opts: {includeHeader: boolean}
  ): fulu.PartialDataColumnSidecar | null {
    const state = this.blocks.get(blockRootHex);
    if (state === undefined) {
      return null;
    }

    const header = opts.includeHeader ? [state.header] : [];
    const column = state.columns.get(subnet);
    if (column === undefined || column.cells.size === 0) {
      if (header.length === 0) {
        return null;
      }

      return {
        cellsPresentBitmap: BitArray.fromBoolArray([]),
        partialColumn: [],
        kzgProofs: [],
        header,
      };
    }

    const bitmap = Array.from({length: column.bitLen}, () => false);
    const partialColumn: Uint8Array[] = [];
    const kzgProofs: Uint8Array[] = [];

    for (let i = 0; i < column.bitLen; i++) {
      const cell = column.cells.get(i);
      if (cell === undefined) {
        continue;
      }

      bitmap[i] = true;
      partialColumn.push(cell.cell);
      kzgProofs.push(cell.proof);
    }

    return {
      cellsPresentBitmap: BitArray.fromBoolArray(bitmap),
      partialColumn,
      kzgProofs,
      header,
    };
  }

  buildHeaderOnlySidecar(blockRootHex: RootHex): fulu.PartialDataColumnSidecar | null {
    const state = this.blocks.get(blockRootHex);
    if (state === undefined) {
      return null;
    }

    return {
      cellsPresentBitmap: BitArray.fromBoolArray([]),
      partialColumn: [],
      kzgProofs: [],
      header: [state.header],
    };
  }

  buildPartsMetadataBytes(blockRootHex: RootHex, subnet: SubnetID): Uint8Array | null {
    const state = this.blocks.get(blockRootHex);
    if (state === undefined) {
      return null;
    }

    const column = state.columns.get(subnet);
    const available = Array.from({length: state.header.kzgCommitments.length}, (_v, index) => column?.cells.has(index) ?? false);
    const requests = available.map((hasCell) => !hasCell);

    return buildPartsMetadataBytes(available, requests);
  }

  getBlockCount(): number {
    return this.blocks.size;
  }

  private getOrCreateColumn(state: PartialBlockState, subnet: SubnetID, bitLen: number): PartialColumnData {
    const existing = state.columns.get(subnet);
    if (existing !== undefined) {
      return existing;
    }

    const column: PartialColumnData = {
      bitLen,
      cells: new Map(),
    };
    state.columns.set(subnet, column);
    return column;
  }

  private touch(blockRootHex: RootHex, state: PartialBlockState): void {
    this.blocks.delete(blockRootHex);
    this.blocks.set(blockRootHex, state);
  }

  private prune(): void {
    while (this.blocks.size > this.maxBlocks) {
      const oldestRoot = this.blocks.keys().next().value;
      if (oldestRoot === undefined) {
        return;
      }
      this.blocks.delete(oldestRoot);
    }
  }
}
