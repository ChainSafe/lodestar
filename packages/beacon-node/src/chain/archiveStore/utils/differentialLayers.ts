import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {DifferentialArchiveStrategy, DifferentialStateOperation} from "../interface.js";

/**
 * Computed over dev machine with performance tests a diff patch take ~325us
 * So a duration of 1024 epochs can be covered with maximum 3 diffs and that will take ~1ms without IO time
 * For block replay it depends upon exactly which slot user requested and what contains in those blocks,
 * but there will always be less than 4 epochs of the block replay.
 *
 * **NOTE:** Changing this default will require nodes to resync.
 *
 * */
export const DEFAULT_DIFF_LAYERS = "2, 8, 32, 128, 512";

export class DifferentialLayers {
  private snapshotEverySlot: number;
  private diffEverySlot: number[];

  /**
   * Initialized with the comma separated values in ascending order e.g. 2,4,6,10
   * These values will represent every nth epoch and each consider as a layer
   * The last value which should be highest should be consider as snapshot layer.
   */
  constructor(layers?: string) {
    const epochs = DifferentialLayers.parse(layers ?? DEFAULT_DIFF_LAYERS);
    this.snapshotEverySlot = epochs[epochs.length - 1] * SLOTS_PER_EPOCH;
    this.diffEverySlot = epochs
      .slice(0, -1)
      // Reverse here, so lower layer get higher priority when matching
      .reverse()
      .map((s) => s * SLOTS_PER_EPOCH);
  }

  getLayersString(): string {
    return `${this.diffEverySlot
      .reverse()
      .map((s) => s / SLOTS_PER_EPOCH)
      .join(",")},${this.snapshotEverySlot / SLOTS_PER_EPOCH}`;
  }

  get totalLayers(): number {
    return this.diffEverySlot.length + 1;
  }

  static parse(layers: string): number[] {
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

    return layerEpochs;
  }

  getArchiveStrategy(slot: Slot): DifferentialArchiveStrategy {
    if (slot === 0) {
      return DifferentialArchiveStrategy.Snapshot;
    }

    if (slot % this.snapshotEverySlot === 0) return DifferentialArchiveStrategy.Snapshot;
    if (this.diffEverySlot.some((s) => slot % s === 0)) return DifferentialArchiveStrategy.Diff;

    return DifferentialArchiveStrategy.BlockReplay;
  }

  getOperation(slot: Slot): DifferentialStateOperation {
    const path: Slot[] = [];
    let lastSlot: number | undefined = undefined;

    for (let layer = 0; layer < this.totalLayers; layer++) {
      const newSlot = this.getLastSlotForLayer(slot, layer);
      if (lastSlot === undefined || newSlot > lastSlot) {
        lastSlot = newSlot;
        path.push(newSlot);
      }
    }
    const layers = [...new Set(path)];
    const snapshotSlot = layers[0];
    const diffSlots = layers.slice(1);
    const lastDiffSlot = diffSlots[diffSlots.length - 1];

    if (slot === lastDiffSlot || slot === snapshotSlot) {
      return {
        snapshotSlot,
        diffSlots,
        blockReplay: undefined,
      };
    }

    return {
      snapshotSlot,
      diffSlots,
      blockReplay: {
        fromSlot: lastDiffSlot ? lastDiffSlot + 1 : snapshotSlot + 1,
        tillSlot: slot,
      },
    };
  }

  getLastSlotForLayer(slot: Slot, layer: number): Slot {
    if (layer < 0 || layer > this.totalLayers) {
      throw new Error(`Invalid layer number. Must be between 0-${this.totalLayers - 1}`);
    }

    if (layer === 0) {
      if (slot % this.snapshotEverySlot === 0) {
        return slot;
      }

      return Math.max(0, slot - (slot % this.snapshotEverySlot));
    }

    const diffEverySlot = this.diffEverySlot[layer - 1];

    if (slot % diffEverySlot === 0) {
      return slot;
    }

    return Math.max(0, slot - (slot % diffEverySlot));
  }
}
