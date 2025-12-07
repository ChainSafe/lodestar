import fs from "node:fs";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {
  EraReader,
  computeEraNumberFromBlockSlot,
  computeStartBlockSlotFromEraNumber,
  computeStateSlotFromEraNumber,
  parseEraName,
} from "@lodestar/era/era";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";

/**
 * EraStore provides read access to historical beacon chain data stored in ERA files.
 */
export class EraStore {
  private readonly config: ChainForkConfig;
  private readonly logger: Logger;
  private readonly eraDirs: string[];

  /** Map of era number -> ERA file path */
  private readonly eraFiles: Map<number, string> = new Map();

  /** Cache of open ERA readers */
  private readonly readerCache: Map<number, EraReader> = new Map();

  /** Index of block root -> {era, slot} for fast lookups */
  private readonly blockRootIndex: Map<RootHex, {era: number; slot: Slot}> = new Map();

  /** Track which eras have been indexed */
  private readonly indexedEras: Set<number> = new Set();

  private constructor(config: ChainForkConfig, logger: Logger, eraDirs: string[]) {
    this.config = config;
    this.logger = logger;
    this.eraDirs = eraDirs;
  }

  /**
   * Create and initialize an EraStore from a directory of ERA files.
   */
  static async create(
    config: ChainForkConfig,
    logger: Logger,
    eraDir: string,
    archiveDir?: string
  ): Promise<EraStore | null> {
    // Collect all valid directories
    const eraDirs: string[] = [];
    if (eraDir && fs.existsSync(eraDir)) {
      eraDirs.push(eraDir);
    }
    if (archiveDir && fs.existsSync(archiveDir) && archiveDir !== eraDir) {
      eraDirs.push(archiveDir);
    }

    if (eraDirs.length === 0) {
      logger.debug("No ERA directories found, EraStore disabled", {eraDir, archiveDir});
      return null;
    }

    const store = new EraStore(config, logger, eraDirs);
    store.scanEraFiles();

    if (store.eraFiles.size === 0) {
      logger.debug("No ERA files found in directories", {eraDirs: eraDirs.join(", ")});
      return null;
    }

    logger.info("EraStore initialized", {
      eraDirs: eraDirs.join(", "),
      eraCount: store.eraFiles.size,
      eraRange: store.getEraRange(),
    });

    return store;
  }

  /**
   * Scan all ERA directories for available files.
   */
  private scanEraFiles(): void {
    for (const eraDir of this.eraDirs) {
      if (!fs.existsSync(eraDir)) continue;

      const files = fs.readdirSync(eraDir).filter((f) => f.endsWith(".era"));

      for (const file of files) {
        try {
          const {eraNumber} = parseEraName(file);
          // Don't overwrite if already found (first directory takes precedence)
          if (!this.eraFiles.has(eraNumber)) {
            this.eraFiles.set(eraNumber, path.join(eraDir, file));
          }
        } catch (e) {
          this.logger.warn("Failed to parse era number from file", {file, error: (e as Error).message});
        }
      }
    }
  }

  private getSortedEras(): number[] {
    return [...this.eraFiles.keys()].sort((a, b) => a - b);
  }

  getEraRange(): string {
    if (this.eraFiles.size === 0) return "none";
    const eras = this.getSortedEras();
    return `${eras[0]}-${eras.at(-1)}`;
  }

  getSlotRange(): {minSlot: Slot; maxSlot: Slot} | null {
    if (this.eraFiles.size === 0) return null;

    // Era 0 contains only genesis state, no blocks
    const blockEras = this.getSortedEras().filter((e) => e > 0);
    if (blockEras.length === 0) return null;

    const minEra = blockEras[0];
    const maxEra = blockEras.at(-1) as number;
    const minSlot = computeStartBlockSlotFromEraNumber(minEra);
    const maxSlot = computeStateSlotFromEraNumber(maxEra) - 1;

    return {minSlot, maxSlot};
  }

  /**
   * Check if a slot is covered by available ERA files.
   */
  hasSlot(slot: Slot): boolean {
    return this.eraFiles.has(computeEraNumberFromBlockSlot(slot));
  }

  /**
   * Get or open an ERA reader for a given era number.
   */
  private async getReader(eraNumber: number): Promise<EraReader | null> {
    const cached = this.readerCache.get(eraNumber);
    if (cached) return cached;

    const filePath = this.eraFiles.get(eraNumber);
    if (!filePath) return null;

    try {
      const reader = await EraReader.open(this.config, filePath);
      this.readerCache.set(eraNumber, reader);
      return reader;
    } catch (e) {
      this.logger.warn("Failed to open ERA file", {eraNumber, error: (e as Error).message});
      return null;
    }
  }

  /**
   * Build block root index for an era using state.blockRoots (lazy, on-demand).
   */
  private async indexEra(eraNumber: number): Promise<void> {
    if (this.indexedEras.has(eraNumber)) return;

    // Era 0 has genesis state only
    if (eraNumber === 0) {
      this.indexedEras.add(eraNumber);
      return;
    }

    const reader = await this.getReader(eraNumber);
    if (!reader) return;

    const group = reader.groups[0];
    if (!group?.blocksIndex) {
      this.indexedEras.add(eraNumber);
      return;
    }

    const stateSlot = computeStateSlotFromEraNumber(eraNumber);
    const serialized = await reader.readSerializedState(eraNumber);
    const state = this.config.getForkTypes(stateSlot).BeaconState.deserializeToViewDU(serialized);

    const startSlot = group.blocksIndex.startSlot;
    for (let i = 0; i < group.blocksIndex.offsets.length; i++) {
      // Skip slots have offset 0
      if (group.blocksIndex.offsets[i] === 0) continue;

      const slot = startSlot + i;
      const blockRoot = state.blockRoots.get(slot % SLOTS_PER_HISTORICAL_ROOT);
      this.blockRootIndex.set(toRootHex(blockRoot), {era: eraNumber, slot});
    }

    this.indexedEras.add(eraNumber);
    this.logger.debug("Indexed ERA file", {eraNumber, indexSize: this.blockRootIndex.size});
  }

  /**
   * Get a block by slot from ERA files.
   */
  async getBlockBySlot(slot: Slot): Promise<SignedBeaconBlock | null> {
    const eraNumber = computeEraNumberFromBlockSlot(slot);
    const reader = await this.getReader(eraNumber);
    if (!reader) return null;

    try {
      return await reader.readBlock(slot);
    } catch (e) {
      this.logger.debug("Failed to read block from ERA", {slot, era: eraNumber, error: (e as Error).message});
      return null;
    }
  }

  /**
   * Get a block by root from ERA files.
   */
  async getBlockByRoot(root: RootHex): Promise<SignedBeaconBlock | null> {
    const location = this.blockRootIndex.get(root);
    if (location) {
      return this.getBlockBySlot(location.slot);
    }

    for (const eraNumber of this.getSortedEras()) {
      if (this.indexedEras.has(eraNumber)) continue;

      await this.indexEra(eraNumber);

      const loc = this.blockRootIndex.get(root);
      if (loc) {
        return this.getBlockBySlot(loc.slot);
      }
    }

    return null;
  }

  /**
   * Close all open ERA readers.
   */
  async close(): Promise<void> {
    for (const reader of this.readerCache.values()) {
      await reader.close();
    }
    this.readerCache.clear();
    this.logger.debug("EraStore closed");
  }
}
