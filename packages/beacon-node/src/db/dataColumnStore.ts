import {ColumnIndex, DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import type {IFlatFileStore} from "./flatFileStore/interface.js";
import type {
  BlockArchiveRepository,
  DataColumnSidecarArchiveRepository,
  DataColumnSidecarRepository,
} from "./repositories/index.js";

export type DataColumnKey = {slot: Slot; blockRoot: RootHex};
export type IndexedDataColumnBytes = {index: ColumnIndex; data: Uint8Array};

type LegacyHotDataColumnStore = Pick<DataColumnSidecarRepository, "values" | "getManyBinary" | "deleteMany">;
type LegacyArchiveDataColumnStore = Pick<
  DataColumnSidecarArchiveRepository,
  "values" | "getManyBinary" | "keys" | "deleteMany"
>;
type BlockRootIndex = Pick<BlockArchiveRepository, "getSlotByRoot">;

export interface IDataColumnStore {
  getAll(key: DataColumnKey): Promise<DataColumnSidecar[]>;
  getManyBinary(key: DataColumnKey, indices: ColumnIndex[]): Promise<(Uint8Array | undefined)[]>;
  putManyBinary(key: DataColumnKey, columns: IndexedDataColumnBytes[]): Promise<void>;
  deleteMany(keys: DataColumnKey[]): Promise<void>;
  pruneBefore(slot: Slot): Promise<void>;
}

/**
 * Bridges pre-flat-file LevelDB columns during the supported in-place upgrade window.
 * Remove the legacy repositories after upgrades from the last pre-flat-file release are no longer supported.
 */
export class LegacyDataColumnStore implements IDataColumnStore {
  constructor(
    private readonly flatFiles: IFlatFileStore,
    private readonly legacyHot: LegacyHotDataColumnStore,
    private readonly legacyArchive: LegacyArchiveDataColumnStore,
    private readonly blockArchive: BlockRootIndex
  ) {}

  async getAll({slot, blockRoot}: DataColumnKey): Promise<DataColumnSidecar[]> {
    const sidecarsByIndex = new Map<ColumnIndex, DataColumnSidecar>();
    for (const sidecar of await this.flatFiles.getDataColumns(slot, blockRoot)) {
      sidecarsByIndex.set(sidecar.index, sidecar);
    }

    const root = fromHex(blockRoot);
    for (const sidecar of await this.legacyHot.values(root)) {
      if (!sidecarsByIndex.has(sidecar.index)) sidecarsByIndex.set(sidecar.index, sidecar);
    }

    if ((await this.blockArchive.getSlotByRoot(root)) === slot) {
      for (const sidecar of await this.legacyArchive.values(slot)) {
        if (!sidecarsByIndex.has(sidecar.index)) sidecarsByIndex.set(sidecar.index, sidecar);
      }
    }

    return [...sidecarsByIndex.values()].sort((a, b) => a.index - b.index);
  }

  async getManyBinary({slot, blockRoot}: DataColumnKey, indices: ColumnIndex[]): Promise<(Uint8Array | undefined)[]> {
    const result = await this.flatFiles.getDataColumnsBinary(slot, blockRoot, indices);
    let missingPositions = getMissingPositions(result);
    if (missingPositions.length === 0) return result;

    const root = fromHex(blockRoot);
    const hotSidecars = await this.legacyHot.getManyBinary(
      root,
      missingPositions.map((position) => indices[position])
    );
    fillMissing(result, missingPositions, hotSidecars);

    missingPositions = getMissingPositions(result);
    if (missingPositions.length === 0 || (await this.blockArchive.getSlotByRoot(root)) !== slot) return result;

    const archivedSidecars = await this.legacyArchive.getManyBinary(
      slot,
      missingPositions.map((position) => indices[position])
    );
    fillMissing(result, missingPositions, archivedSidecars);
    return result;
  }

  async putManyBinary({slot, blockRoot}: DataColumnKey, columns: IndexedDataColumnBytes[]): Promise<void> {
    await this.flatFiles.putDataColumnsBinary(slot, blockRoot, columns);
  }

  async deleteMany(keys: DataColumnKey[]): Promise<void> {
    await this.flatFiles.deleteMany(keys);
    await this.legacyHot.deleteMany(keys.map(({blockRoot}) => fromHex(blockRoot)));
  }

  async pruneBefore(slot: Slot): Promise<void> {
    await this.flatFiles.pruneBefore(slot);
    const prefixedKeys = await this.legacyArchive.keys({lt: {prefix: slot, id: 0}});
    const slots = [...new Set(prefixedKeys.map(({prefix}) => prefix))];
    if (slots.length > 0) await this.legacyArchive.deleteMany(slots);
  }
}

function getMissingPositions(sidecars: (Uint8Array | undefined)[]): number[] {
  const positions: number[] = [];
  for (let i = 0; i < sidecars.length; i++) {
    if (sidecars[i] === undefined) positions.push(i);
  }
  return positions;
}

function fillMissing(
  result: (Uint8Array | undefined)[],
  missingPositions: number[],
  sidecars: (Uint8Array | null | undefined)[]
): void {
  for (let i = 0; i < missingPositions.length; i++) {
    const sidecar = sidecars[i];
    if (sidecar != null) result[missingPositions[i]] = sidecar;
  }
}
