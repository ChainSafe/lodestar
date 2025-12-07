import fs from "node:fs";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {
  EraWriter,
  computeStartBlockSlotFromEraNumber,
  computeStateSlotFromEraNumber,
  getShortHistoricalRoot,
  parseEraName,
} from "@lodestar/era/era";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {BeaconState, Epoch} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/interface.js";

const EPOCHS_PER_ERA = SLOTS_PER_HISTORICAL_ROOT / SLOTS_PER_EPOCH;

export function computeMaxArchivableEra(config: ChainForkConfig, currentEpoch: Epoch, finalizedEpoch: Epoch): number {
  // Archive 1 era + 1 epoch before blocks become prunable
  const archiveCutoffEpoch = Math.max(currentEpoch - config.MIN_EPOCHS_FOR_BLOCK_REQUESTS + EPOCHS_PER_ERA + 1, 0);
  // Don't archive beyond finalized
  const safeArchiveEpoch = Math.min(archiveCutoffEpoch, finalizedEpoch);
  const archiveCutoffSlot = computeStartSlotAtEpoch(safeArchiveEpoch);

  // Era N's state is at slot N * SLOTS_PER_HISTORICAL_ROOT
  return Math.floor(archiveCutoffSlot / SLOTS_PER_HISTORICAL_ROOT);
}

/**
 * Archives complete eras to era files.
 * Returns the new lastArchivedEra value.
 */
export async function archiveToEra(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  archiveDir: string,
  currentEpoch: Epoch,
  finalizedEpoch: Epoch,
  lastArchivedEra: number
): Promise<number> {
  const maxEraToArchive = computeMaxArchivableEra(config, currentEpoch, finalizedEpoch);

  logger.debug("Era archiver check", {maxEraToArchive, lastArchivedEra});

  let newLastArchivedEra = lastArchivedEra;

  // Ensure archive directory exists
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, {recursive: true});
  }

  for (let eraNumber = lastArchivedEra + 1; eraNumber <= maxEraToArchive; eraNumber++) {
    try {
      const success = await writeEra(config, db, logger, archiveDir, eraNumber);
      if (success) {
        newLastArchivedEra = eraNumber;
        logger.info("Archived era to file", {eraNumber});
      } else {
        logger.debug("Era not ready for archiving", {eraNumber});
        break;
      }
    } catch (e) {
      logger.error("Failed to archive era", {eraNumber}, e as Error);
      break;
    }
  }

  return newLastArchivedEra;
}

/**
 * Writes a complete era file containing blocks and state.
 * Era 0 contains only the genesis state (no blocks).
 */
async function writeEra(
  config: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  archiveDir: string,
  eraNumber: number
): Promise<boolean> {
  const stateSlot = computeStateSlotFromEraNumber(eraNumber);

  // Check if state is available at the era boundary
  const stateBytes = await db.stateArchive.getBinary(stateSlot);
  if (!stateBytes) {
    logger.debug("State not available for era", {eraNumber, stateSlot});
    return false;
  }

  // Create temporary file for writing
  const tempPath = path.join(archiveDir, `era-${eraNumber}.tmp`);
  const writer = await EraWriter.create(config, tempPath, eraNumber);

  try {
    // Era 0 has no blocks, only genesis state
    let blocksWritten = 0;
    if (eraNumber > 0) {
      const blockStartSlot = computeStartBlockSlotFromEraNumber(eraNumber);
      const blockEndSlot = stateSlot - 1;
      for await (const entry of db.blockArchive.binaryEntriesStream({gte: blockStartSlot, lte: blockEndSlot})) {
        const slot = db.blockArchive.decodeKey(entry.key);
        await writer.writeSerializedBlock(slot, entry.value);
        blocksWritten++;
      }
    }

    logger.debug("Writing era state", {eraNumber, stateSlot, blocksWritten});

    const state = config.getForkTypes(stateSlot).BeaconState.deserializeToViewDU(stateBytes) as unknown as BeaconState;
    const shortHistoricalRoot = getShortHistoricalRoot(config, state);
    await writer.writeSerializedState(stateSlot, shortHistoricalRoot, stateBytes);

    const finalPath = await writer.finish();
    logger.debug("Created era file", {eraNumber, path: finalPath, blocksWritten});

    return true;
  } catch (e) {
    await writer.fh.close();
    fs.unlinkSync(tempPath);

    throw e;
  }
}

/**
 * Scans the archive directory to detect the last archived era number.
 * Returns -1 if no era files exist (so archiving starts from era 0).
 */
export function detectLastArchivedEra(archiveDir: string, configName: string): number {
  if (!fs.existsSync(archiveDir)) {
    return -1;
  }

  const files = fs.readdirSync(archiveDir);
  let maxEra = -1;

  for (const file of files) {
    if (!file.endsWith(".era")) continue;

    const {configName: fileConfigName, eraNumber} = parseEraName(file);
    if (fileConfigName === configName && eraNumber > maxEra) {
      maxEra = eraNumber;
    }
  }

  return maxEra;
}
