import type {FileHandle} from "node:fs/promises";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT, isForkPostCapella} from "@lodestar/params";
import {BeaconState, Slot, capella, ssz} from "@lodestar/types";
import {E2STORE_HEADER_SIZE, SlotIndex, readSlotIndex} from "../e2s.ts";
import {readUint48} from "../util.ts";

/**
 * Parsed components of an .era file name.
 * Format: <config-name>-<era-number>-<short-historical-root>.era
 */
export interface EraFileName {
  /** CONFIG_NAME field of runtime config (mainnet, sepolia, holesky, etc.) */
  configName: string;
  /** Number of the first era stored in file, 5-digit zero-padded (00000, 00001, etc.) */
  eraNumber: number;
  /** First 4 bytes of last historical root, lower-case hex-encoded (8 chars) */
  shortHistoricalRoot: string;
}

export interface EraIndices {
  stateIndex: SlotIndex;
  blocksIndex?: SlotIndex;
}

/** Return true if `slot` is within the era range */
export function isSlotInRange(slot: Slot, eraNumber: number): boolean {
  return computeEraNumberFromBlockSlot(slot) === eraNumber;
}

export function isValidEraStateSlot(slot: Slot, eraNumber: number): boolean {
  return slot % SLOTS_PER_HISTORICAL_ROOT === 0 && slot / SLOTS_PER_HISTORICAL_ROOT === eraNumber;
}

export function computeEraNumberFromBlockSlot(slot: Slot): number {
  return Math.floor(slot / SLOTS_PER_HISTORICAL_ROOT) + 1;
}

export function computeStartBlockSlotFromEraNumber(eraNumber: number): Slot {
  if (eraNumber === 0) {
    throw new Error("Genesis era (era 0) does not contain blocks");
  }
  return (eraNumber - 1) * SLOTS_PER_HISTORICAL_ROOT;
}

/**
 * Parse era filename.
 *
 * Format: `<config-name>-<era-number>-<short-historical-root>.era`
 */
export function parseEraName(filename: string): {configName: string; eraNumber: number; shortHistoricalRoot: string} {
  const match = filename.match(/^(.*)-(\d{5})-([0-9a-f]{8})\.era$/);
  if (!match) {
    throw new Error(`Invalid era filename format: ${filename}`);
  }
  return {
    configName: match[1],
    eraNumber: parseInt(match[2], 10),
    shortHistoricalRoot: match[3],
  };
}

/**
 * Read all indices from an era file.
 */
export async function readAllEraIndices(fh: FileHandle): Promise<EraIndices[]> {
  let end = (await fh.stat()).size;

  const indices: EraIndices[] = [];
  while (end > E2STORE_HEADER_SIZE) {
    const index = await readEraIndexes(fh, end);
    indices.push(index);
    end = index.blocksIndex
      ? index.blocksIndex.recordStart + index.blocksIndex.offsets[0] - E2STORE_HEADER_SIZE
      : index.stateIndex.recordStart + index.stateIndex.offsets[0] - E2STORE_HEADER_SIZE;
  }
  return indices;
}

/**
 * Read state and block SlotIndex entries from an era file and validate alignment.
 */
export async function readEraIndexes(fh: FileHandle, end: number): Promise<EraIndices> {
  const stateIndex = await readSlotIndex(fh, end);
  if (stateIndex.offsets.length !== 1) {
    throw new Error(`State SlotIndex must have exactly one offset, got ${stateIndex.offsets.length}`);
  }

  // Read block index if not genesis era (era 0)
  let blocksIndex: SlotIndex | undefined;
  if (stateIndex.startSlot > 0) {
    blocksIndex = await readSlotIndex(fh, stateIndex.recordStart);
    if (blocksIndex.offsets.length !== SLOTS_PER_HISTORICAL_ROOT) {
      throw new Error(
        `Block SlotIndex must have exactly ${SLOTS_PER_HISTORICAL_ROOT} offsets, got ${blocksIndex.offsets.length}`
      );
    }

    // Validate block and state indices are properly aligned
    const expectedBlockStartSlot = stateIndex.startSlot - SLOTS_PER_HISTORICAL_ROOT;
    if (blocksIndex.startSlot !== expectedBlockStartSlot) {
      throw new Error(
        `Block index alignment error: expected startSlot=${expectedBlockStartSlot}, ` +
          `got startSlot=${blocksIndex.startSlot} (should be exactly one era before state)`
      );
    }
  }

  return {stateIndex, blocksIndex};
}

export function readSlotFromBeaconStateBytes(beaconStateBytes: Uint8Array): Slot {
  // not technically a Uint48, but for practical purposes fits within 6 bytes
  return readUint48(
    beaconStateBytes,
    // slot is at offset 40: 8 (genesisTime) + 32 (genesisValidatorsRoot)
    40
  );
}

export function getShortHistoricalRoot(config: ChainForkConfig, state: BeaconState): string {
  return Buffer.from(
    state.slot === 0
      ? state.genesisValidatorsRoot
      : // Post-Capella, historical_roots is replaced by historical_summaries
        isForkPostCapella(config.getForkName(state.slot))
        ? ssz.capella.HistoricalSummary.hashTreeRoot(
            (state as capella.BeaconState).historicalSummaries.at(-1) as capella.BeaconState["historicalSummaries"][0]
          )
        : (state.historicalRoots.at(-1) as Uint8Array)
  )
    .subarray(0, 4)
    .toString("hex");
}
