import {Epoch, Slot} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {HistoricalStateStorageType} from "../types.js";
import {StateArchiveMode} from "../../archiver/interface.js";

/*
 * Computed over dev machine with performance tests a diff patch take ~325us
 * So a duration of 1024 epochs can be covered with maximum 3 diffs and that will take ~1ms without IO time
 * For block replay it depends upon exactly which slot user requested and what contains in those blocks,
 * but there will always be less than 4 epochs of the block replay.
 *
 * NOTE: Changing this default will require nodes to resync.
 */
export const DEFAULT_DIFF_LAYERS = "2, 8, 32, 128, 512";

export class HierarchicalLayers {
  private snapshotEverySlot: number;
  private diffEverySlot: number[];

  /**
   * Initialized with the comma separated values in ascending order e.g. 2,4,6,10
   * These values will represent every nth epoch and each consider as a layer
   * The last value which should be highest should be consider as snapshot layer.
   */
  constructor(epochs: Epoch[]) {
    this.snapshotEverySlot = epochs[epochs.length - 1] * SLOTS_PER_EPOCH;

    this.diffEverySlot = epochs
      .slice(0, -1)
      // Reverse here, so lower layer get higher priority when matching
      .reverse()
      .map((s) => s * SLOTS_PER_EPOCH);
  }

  static fromString(layers: string = DEFAULT_DIFF_LAYERS) {
    const layerEpochs = [
      ...new Set(
        layers
          .split(",")
          .map((s) => s.trim())
          .map((n) => parseInt(n))
      ),
    ];

    if (layerEpochs.length !== layers.split(",").length) {
      throw new Error(`Please provide unique epoch intervals. Given = ${layers}`);
    }

    if ([...layerEpochs].sort((a, b) => a - b).join(",") !== layerEpochs.join(",")) {
      throw new Error(`Please provide diff layers in ascending order. Given = ${layers}`);
    }

    return new HierarchicalLayers(layerEpochs);
  }

  toString(): string {
    return `${this.diffEverySlot
      .reverse()
      .map((s) => s / SLOTS_PER_EPOCH)
      .join(",")},${this.snapshotEverySlot / SLOTS_PER_EPOCH}`;
  }

  get totalLayers(): number {
    return this.diffEverySlot.length + 1;
  }

  getStorageType(slot: Slot, stateArchiveMode: StateArchiveMode): HistoricalStateStorageType {
    if (stateArchiveMode === StateArchiveMode.Frequency) return HistoricalStateStorageType.Full;

    if (slot === 0) {
      return HistoricalStateStorageType.Snapshot;
    }

    if (slot % this.snapshotEverySlot === 0) return HistoricalStateStorageType.Snapshot;
    if (this.diffEverySlot.some((s) => slot % s === 0)) return HistoricalStateStorageType.Diff;

    return HistoricalStateStorageType.BlockReplay;
  }

  getArchiveLayers(slot: Slot): Slot[] {
    const path: Slot[] = [];
    let lastSlot: number | undefined = undefined;

    for (let layer = 0; layer < this.totalLayers; layer++) {
      const newSlot = this.getPreviousSlotForLayer(slot, layer);
      if (lastSlot === undefined || newSlot > lastSlot) {
        lastSlot = newSlot;
        path.push(newSlot);
      }
    }
    return [...new Set(path)];
  }

  getPreviousSlotForLayer(slot: Slot, layer: number): Slot {
    if (layer < 0 || layer > this.totalLayers) {
      throw new Error(`Invalid layer number. Must be between 0-${this.totalLayers - 1}`);
    }

    if (layer === 0) {
      if (slot % this.snapshotEverySlot === 0) return slot;

      return Math.max(0, slot - (slot % this.snapshotEverySlot));
    }

    const diffEverySlot = this.diffEverySlot[layer - 1];

    if (slot % diffEverySlot === 0) return slot;

    return Math.max(0, slot - (slot % diffEverySlot));
  }
}
