import {type FileHandle, open} from "node:fs/promises";
import {basename} from "node:path";
import {PublicKey, Signature, verify} from "@chainsafe/blst";
import {ChainForkConfig, createCachedGenesis} from "@lodestar/config";
import {DOMAIN_BEACON_PROPOSER, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconState, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {E2STORE_HEADER_SIZE, EntryType, readEntry, readVersion} from "../e2s.ts";
import {snappyUncompress} from "../util.ts";
import {
  EraIndices,
  computeEraNumberFromBlockSlot,
  parseEraName,
  readAllEraIndices,
  readSlotFromBeaconStateBytes,
} from "./util.ts";

/**
 * EraReader is responsible for reading and validating ERA files.
 *
 * See https://github.com/eth-clients/e2store-format-specs/blob/main/formats/era.md
 */
export class EraReader {
  readonly config: ChainForkConfig;
  /** The underlying file handle */
  readonly fh: FileHandle;
  /** The era number retrieved from the file name */
  readonly eraNumber: number;
  /** The short historical root retrieved from the file name */
  readonly shortHistoricalRoot: string;
  /** An array of state and block indices, one per group */
  readonly groups: EraIndices[];

  constructor(
    config: ChainForkConfig,
    fh: FileHandle,
    eraNumber: number,
    shortHistoricalRoot: string,
    indices: EraIndices[]
  ) {
    this.config = config;
    this.fh = fh;
    this.eraNumber = eraNumber;
    this.shortHistoricalRoot = shortHistoricalRoot;
    this.groups = indices;
  }

  static async open(config: ChainForkConfig, path: string): Promise<EraReader> {
    const fh = await open(path, "r");
    const name = basename(path);
    const {configName, eraNumber, shortHistoricalRoot} = parseEraName(name);
    if (config.CONFIG_NAME !== configName) {
      throw new Error(`Config name mismatch: expected ${config.CONFIG_NAME}, got ${configName}`);
    }
    const indices = await readAllEraIndices(fh);
    return new EraReader(config, fh, eraNumber, shortHistoricalRoot, indices);
  }

  /**
   * Close the underlying file descriptor
   *
   * No further actions can be taken after this operation
   */
  async close(): Promise<void> {
    await this.fh.close();
  }

  async readCompressedState(eraNumber?: number): Promise<Uint8Array> {
    eraNumber = eraNumber ?? this.eraNumber;
    const index = this.groups.at(eraNumber - this.eraNumber);
    if (!index) {
      throw new Error(`No index found for era number ${eraNumber}`);
    }
    const entry = await readEntry(this.fh, index.stateIndex.recordStart + index.stateIndex.offsets[0]);

    if (entry.type !== EntryType.CompressedBeaconState) {
      throw new Error(`Expected CompressedBeaconState, got ${entry.type}`);
    }

    return entry.data;
  }

  async readSerializedState(eraNumber?: number): Promise<Uint8Array> {
    const compressed = await this.readCompressedState(eraNumber);
    return snappyUncompress(compressed);
  }

  async readState(eraNumber?: number): Promise<BeaconState> {
    const serialized = await this.readSerializedState(eraNumber);
    const stateSlot = readSlotFromBeaconStateBytes(serialized);
    return this.config.getForkTypes(stateSlot).BeaconState.deserialize(serialized);
  }

  async readCompressedBlock(slot: Slot): Promise<Uint8Array | null> {
    const slotEra = computeEraNumberFromBlockSlot(slot);
    const index = this.groups.at(slotEra - this.eraNumber);
    if (!index) {
      throw new Error(`Slot ${slot} is out of range`);
    }
    if (!index.blocksIndex) {
      throw new Error(`No block index found for era number ${slotEra}`);
    }
    // Calculate offset within the index
    const indexOffset = slot - index.blocksIndex.startSlot;
    const offset = index.blocksIndex.recordStart + index.blocksIndex.offsets[indexOffset];
    if (offset === 0) {
      return null; // Empty slot
    }

    const entry = await readEntry(this.fh, offset);
    if (entry.type !== EntryType.CompressedSignedBeaconBlock) {
      throw new Error(`Expected CompressedSignedBeaconBlock, got ${EntryType[entry.type] ?? "unknown"}`);
    }
    return entry.data;
  }

  async readSerializedBlock(slot: Slot): Promise<Uint8Array | null> {
    const compressed = await this.readCompressedBlock(slot);
    if (compressed === null) return null;
    return snappyUncompress(compressed);
  }

  async readBlock(slot: Slot): Promise<SignedBeaconBlock | null> {
    const serialized = await this.readSerializedBlock(slot);
    if (serialized === null) return null;
    return this.config.getForkTypes(slot).SignedBeaconBlock.deserialize(serialized);
  }

  /**
   * Validate the era file.
   * - e2s format correctness
   * - era range correctness
   * - network correctness for state and blocks
   * - block root and signature matches
   */
  async validate(): Promise<void> {
    for (let groupIndex = 0; groupIndex < this.groups.length; groupIndex++) {
      const eraNumber = this.eraNumber + groupIndex;
      const index = this.groups[groupIndex];

      // validate version entry
      const start = index.blocksIndex
        ? index.blocksIndex.recordStart + index.blocksIndex.offsets[0] - E2STORE_HEADER_SIZE
        : index.stateIndex.recordStart + index.stateIndex.offsets[0] - E2STORE_HEADER_SIZE;
      await readVersion(this.fh, start);

      // validate state
      // the state is loadable and consistent with the given runtime configuration
      const state = await this.readState(eraNumber);
      const cachedGenesis = createCachedGenesis(this.config, state.genesisValidatorsRoot);

      if (eraNumber === 0 && index.blocksIndex) {
        throw new Error("Genesis era (era 0) should not have blocks index");
      }
      if (eraNumber !== 0) {
        if (!index.blocksIndex) {
          throw new Error(`Era ${eraNumber} is missing blocks index`);
        }

        // validate blocks
        for (
          let slot = index.blocksIndex.startSlot;
          slot < index.blocksIndex.startSlot + index.blocksIndex.offsets.length;
          slot++
        ) {
          const block = await this.readBlock(slot);
          if (block === null) {
            if (slot === index.blocksIndex.startSlot) continue; // first slot in the era can't be easily validated
            if (
              Buffer.compare(
                state.blockRoots[(slot - 1) % SLOTS_PER_HISTORICAL_ROOT],
                state.blockRoots[slot % SLOTS_PER_HISTORICAL_ROOT]
              ) !== 0
            ) {
              throw new Error(`Block root mismatch at slot ${slot} for empty slot`);
            }
            continue;
          }

          const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
          if (Buffer.compare(blockRoot, state.blockRoots[slot % SLOTS_PER_HISTORICAL_ROOT]) !== 0) {
            throw new Error(`Block root mismatch at slot ${slot}`);
          }
          const msg = ssz.phase0.SigningData.hashTreeRoot({
            objectRoot: blockRoot,
            domain: cachedGenesis.getDomain(slot, DOMAIN_BEACON_PROPOSER),
          });
          const pk = PublicKey.fromBytes(state.validators[block.message.proposerIndex].pubkey);
          const sig = Signature.fromBytes(block.signature);
          if (!verify(msg, pk, sig, true, true)) {
            throw new Error(`Block signature verification failed at slot ${slot}`);
          }
        }
      }
    }
  }
}
