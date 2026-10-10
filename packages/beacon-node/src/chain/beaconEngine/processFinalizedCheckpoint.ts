/**
 * Finalization spans two owners: BeaconEngine owns fork choice, blocks, envelopes and state archival;
 * BeaconChain owns data columns and ChainView. Its ArchiveStore facade must coordinate their work in order:
 * 1. Archive canonical blocks, sidecars and envelopes, then optionally persist orphaned blocks.
 * 2. Clean up noncanonical data (columns before their blocks), expired sidecars and light-client data,
 *    then prune history if enabled.
 * 3. Call completeFinalization to finish state archival before pruning the engine's fork choice.
 * 4. Only after that resolves, prune BeaconChain's ChainView.
 *
 * Fork choice and ChainView retain the roots, ancestry and payload variants needed to select data throughout
 * this flow. Prune their metadata last, after the dependent work succeeds, so failures during archival or
 * cleanup leave that metadata available for a later attempt. Individual migration helpers must not prune it.
 *
 * Upstream comparison: local origin/unstable at 0edec865c8d88a9457364fc648eef3a5c905d72d.
 * Commit: 2026-10-08, "feat: persist earliest available slot (#10267)".
 * Source paths below are relative to packages/beacon-node/src/.
 */
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, Slot} from "@lodestar/types";
import {Logger, fromHex, prettyPrintIndices} from "@lodestar/utils";
import {IBeaconEngineDb} from "../../db/index.js";
import {BlockArchiveBatchPutBinaryItem, encodeArchivedHeaderEnvelope} from "../../db/repositories/index.js";
import {ensureDir, writeIfNotExist} from "../../util/file.js";
import {toSignedHeaderEnvelope} from "../../util/headerEnvelope.js";
import {BlockRootHex} from "../../util/sszBytes.js";
import {StateArchiveStrategy} from "../archiveStore/interface.js";
import {pruneHistory as pruneHistoryFromDb} from "../archiveStore/utils/pruneHistory.js";
import {FinalizedProtoSummary} from "../chainView/interface.js";
import type {BeaconEngine} from "./beaconEngine.js";
import {LateCanonicalBlockReason} from "./interface.js";

// Process in chunks to avoid OOM
// this number of blocks per chunk is tested in e2e test blockArchive.test.ts
// TODO: Review after merge since the size of blocks will increase significantly
const BLOCK_BATCH_SIZE = 256;

/**
 * Sources: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#migrateBlocksFromHotToColdDb
 * and #archiveBlocks (canonical selection, late-block audit, and migration logging).
 * The sync gate comes from chain/archiveStore/archiveStore.ts#ArchiveStore.processFinalizedCheckpoint.
 * [beacon-engine] Read finalized ancestors and clock from the engine; audit only newly migrated blocks after writes.
 */
export async function migrateBlocksFromHotToColdDb(this: BeaconEngine): Promise<Slot[]> {
  const {db, logger, forkChoice, clock, metrics} = this;
  const finalized = forkChoice.getFinalizedCheckpoint();
  const {ancestors: blocks} = forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(finalized.rootHex);
  const currentEpoch = clock.currentEpoch;
  const logCtx = {currentEpoch, finalizedEpoch: finalized.epoch, finalizedRoot: finalized.rootHex};
  const isNodeSynced = clock.currentSlot - forkChoice.getHead().slot <= SLOTS_PER_EPOCH;
  // Fork choice retains previously finalized blocks. Missing hot DB bytes mean they were already migrated.
  const migratedSlots: Slot[] = [];
  for (let i = 0; i < blocks.length; i += BLOCK_BATCH_SIZE) {
    const toIdx = Math.min(i + BLOCK_BATCH_SIZE, blocks.length);
    const canonicalBlocks = blocks.slice(i, toIdx);

    if (canonicalBlocks.length === 0) break;

    // load Buffer instead of SignedBeaconBlock to improve performance
    const canonicalBlockEntries = (
      await Promise.all(
        canonicalBlocks.map(async (block): Promise<BlockArchiveBatchPutBinaryItem | null> => {
          const root = fromHex(block.blockRoot);
          const blockBuffer = await db.block.getBinary(root);
          if (!blockBuffer) {
            logger.debug("Block in forkchoice but missing in hot db, could be already archived", {
              slot: block.slot,
              root: block.blockRoot,
            });
            return null;
          }
          return {
            key: block.slot,
            value: blockBuffer,
            slot: block.slot,
            blockRoot: root,
            // TODO: Benchmark if faster to slice Buffer or fromHex()
            parentRoot: getParentRootFromSignedBlock(blockBuffer),
          };
        })
      )
    ).filter((entry): entry is BlockArchiveBatchPutBinaryItem => entry !== null);

    if (canonicalBlockEntries.length === 0) continue;

    await Promise.all([
      db.blockArchive.batchPutBinary(canonicalBlockEntries),
      db.block.batchDelete(canonicalBlockEntries.map((entry) => entry.blockRoot)),
    ]);
    for (const entry of canonicalBlockEntries) migratedSlots.push(entry.slot);
  }

  if (isNodeSynced && migratedSlots.length > 0) {
    try {
      const migrated = new Set(migratedSlots);
      // Exclude the retained boundary and blocks already archived by earlier checkpoint jobs.
      const lateBlocks = blocks.slice(0, -1).filter((block) => migrated.has(block.slot) && !block.importedTimely);
      if (lateBlocks.length > 0) {
        let slowImport = 0;
        for (const block of lateBlocks) {
          const reason = block.timeliness ? LateCanonicalBlockReason.SlowImport : LateCanonicalBlockReason.LateReceive;
          if (block.timeliness) slowImport++;
          metrics?.importBlock.lateCanonicalBlock.inc({reason});
        }
        logger.verbose("Late imported canonical blocks", {
          ...logCtx,
          count: lateBlocks.length,
          slowImport,
          lateReceive: lateBlocks.length - slowImport,
          slotRange: prettyPrintIndices(lateBlocks.map((block) => block.slot).sort((a, b) => a - b)),
        });
      }
    } catch (e) {
      logger.error("Error auditing late canonical blocks", logCtx, e as Error);
    }
  }
  // Ancestor walk is newest to oldest; sort ascending so `prettyPrintIndices` renders cleanly.
  migratedSlots.sort((a, b) => a - b);
  logger.verbose("Migrated blocks from hot DB to cold DB", {
    ...logCtx,
    fromSlot: blocks[0]?.slot,
    toSlot: blocks.at(-1)?.slot,
    size: blocks.length,
    migratedEntries: migratedSlots.length,
    slotRange: prettyPrintIndices(migratedSlots),
  });
  return migratedSlots;
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#archiveBlocks
 * (finalizedPostGloas migration call and logging).
 * [beacon-engine] Select canonical ancestors and read dedupePayloads from the engine instead of caller arguments.
 */
export async function migrateExecutionPayloadEnvelopes(this: BeaconEngine): Promise<Slot[]> {
  const finalized = this.forkChoice.getFinalizedCheckpoint();
  const {ancestors} = this.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(finalized.rootHex);
  const currentEpoch = this.clock.currentEpoch;
  const migratedSlots = await migrateExecutionPayloadEnvelopesFromHotToColdDb(
    this.config,
    this.db,
    this.logger,
    ancestors,
    this.opts.dedupePayloads ?? true
  );
  this.logger.verbose("Migrated executionPayloadEnvelopes from hot DB to cold DB", {
    currentEpoch,
    finalizedEpoch: finalized.epoch,
    finalizedRoot: finalized.rootHex,
    migratedEntries: migratedSlots.length,
    slotRange: prettyPrintIndices(migratedSlots),
  });
  return migratedSlots;
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#archiveBlocks
 * (noncanonical executionPayloadEnvelope.batchDelete).
 */
export async function deleteNonCanonicalExecutionPayloadEnvelopes(
  this: BeaconEngine,
  roots: Uint8Array[]
): Promise<void> {
  await this.db.executionPayloadEnvelope.batchDelete(roots);
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#archiveBlocks
 * (persistOrphanedBlocks branch before noncanonical deletion).
 * [beacon-engine] Read bytes through the engine DB and use its configured directory as a fallback.
 */
export async function persistOrphanedBlocks(
  this: BeaconEngine,
  blocks: FinalizedProtoSummary[],
  directory?: string
): Promise<void> {
  await Promise.all(
    blocks.map(async (block) => {
      const bytes = await this.db.block.getBinary(fromHex(block.blockRoot));
      if (bytes)
        await persistOrphanedBlock(block.slot, block.blockRoot, bytes, {
          persistOrphanedBlocksDir: directory ?? this.opts.persistOrphanedBlocksDir ?? "orphaned_blocks",
        });
      else
        this.logger.warn("Tried to persist orphaned block but no block found", {
          slot: block.slot,
          block: block.blockRoot,
        });
    })
  );
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#archiveBlocks
 * (noncanonical block.batchDelete after sidecar cleanup).
 */
export async function deleteNonCanonicalBlocks(this: BeaconEngine, roots: Uint8Array[]): Promise<void> {
  await this.db.block.batchDelete(roots);
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/archiveStore.ts#ArchiveStore.processFinalizedCheckpoint
 * (onFinalizedCheckpoint, maybeArchiveState, then forkChoice.prune).
 * [beacon-engine] ArchiveStore must await archival and cleanup on both owners before calling this.
 * State archival below is the last dependency on the unpruned fork choice. The facade prunes ChainView only
 * after this resolves; do not move fork-choice pruning into the earlier block or envelope migration steps.
 * ChainView publication is engine-specific.
 */
export async function completeFinalization(
  this: BeaconEngine,
  finalized: CheckpointWithHex,
  stateArchiveStrategy: StateArchiveStrategy
): Promise<number> {
  await stateArchiveStrategy.onFinalizedCheckpoint(finalized, this.metrics);
  await stateArchiveStrategy.maybeArchiveState(finalized, this.metrics);
  const count = this.forkChoice.prune(finalized.rootHex).length;
  // TODO - beacon engine: re-review this
  this.publishChainView();
  return count;
}

/**
 * Sources: unstable@0edec865c8 chain/archiveStore/archiveStore.ts#ArchiveStore.init / processFinalizedCheckpoint
 * and chain/archiveStore/utils/pruneHistory.ts#pruneHistory.
 * [beacon-engine] The pruning cursor stays private on BeaconEngine and advances only after this succeeds.
 * Merge note: upstream now deletes envelopes inside its pruneHistory helper and calls beforePrune to persist
 * earliestAvailableSlot before deletion. This branch still deletes envelopes afterward and lacks that hook.
 */
export async function pruneHistory(
  this: BeaconEngine,
  finalizedEpoch: Epoch,
  currentEpoch: Epoch,
  statePruneFromSlot: Slot = 0
): Promise<{blockCutoffSlot: Slot; stateCutoffSlot: Slot}> {
  const {blockCutoffSlot, stateCutoffSlot} = await pruneHistoryFromDb(
    this.config,
    this.db,
    this.logger,
    this.metrics,
    finalizedEpoch,
    currentEpoch,
    statePruneFromSlot
  );
  await this.db.executionPayloadEnvelopeArchive.batchDelete(
    await this.db.executionPayloadEnvelopeArchive.keys({gte: 0, lt: blockCutoffSlot})
  );
  return {blockCutoffSlot, stateCutoffSlot};
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#persistOrphanedBlock.
 * Persist orphaned block to disk.
 */
export async function persistOrphanedBlock(
  slot: Slot,
  blockRoot: BlockRootHex,
  bytes: Uint8Array,
  opts: {
    persistOrphanedBlocksDir: string;
  }
) {
  const dirpath = path.join(opts.persistOrphanedBlocksDir ?? "orphaned_blocks");
  const filepath = path.join(dirpath, `${slot}_${blockRoot}.ssz`);
  await ensureDir(dirpath);
  await writeIfNotExist(filepath, bytes);
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#migrateExecutionPayloadEnvelopesFromHotToColdDb.
 * [beacon-engine] Use IBeaconEngineDb and FinalizedProtoSummary; preserve the upstream migration body.
 *
 * Post-gloas given a finalized checkpoint at a block root, payload of that block root
 * is not considered finalized, hence they are archived in the next run.
 *
 * With `dedupePayloads` (default), execution-valid envelopes are archived as header envelopes. Envelopes of
 * still-optimistic blocks are archived in full, since the EL may not serve their bodies, and are not
 * converted later. Archive put + hot delete are one atomic db batch.
 */
export async function migrateExecutionPayloadEnvelopesFromHotToColdDb(
  config: ChainForkConfig,
  db: IBeaconEngineDb,
  logger: Logger,
  canonicalBlocks: FinalizedProtoSummary[],
  dedupePayloads: boolean
): Promise<Slot[]> {
  const payloadBlocks = canonicalBlocks.filter(
    (block) => config.getForkSeq(block.slot) >= ForkSeq.gloas && block.payloadStatus === PayloadStatus.FULL
  );
  if (payloadBlocks.length === 0) return [];

  const migratedSlots: Slot[] = [];

  // Process in chunks to bound memory: after a long non-finality period the ancestor walk can span
  // thousands of blocks, and each full envelope is a few hundred KB when deserialized.
  for (let i = 0; i < payloadBlocks.length; i += BLOCK_BATCH_SIZE) {
    const batch = payloadBlocks.slice(i, i + BLOCK_BATCH_SIZE);
    // Only header envelopes need deserializing; full ones are copied as bytes
    const archivedBytesArray = await Promise.all(
      batch.map(async (block) => {
        const root = fromHex(block.blockRoot);
        if (dedupePayloads && block.executionStatus === ExecutionStatus.Valid) {
          const envelope = await db.executionPayloadEnvelope.get(root);
          return envelope === null ? null : encodeArchivedHeaderEnvelope(toSignedHeaderEnvelope(envelope));
        }
        return db.executionPayloadEnvelope.getBinary(root);
      })
    );

    const entries: {slot: Slot; archivedBytes: Uint8Array; hotKey: Uint8Array}[] = [];
    for (let j = 0; j < batch.length; j++) {
      const block = batch[j];
      const archivedBytes = archivedBytesArray[j];
      if (archivedBytes === null) {
        logger.debug("ExecutionPayloadEnvelope in forkchoice but missing in hot db, could be already archived", {
          slot: block.slot,
          root: block.blockRoot,
        });
        continue;
      }

      entries.push({
        slot: block.slot,
        archivedBytes,
        hotKey: db.executionPayloadEnvelope.encodeKey(fromHex(block.blockRoot)),
      });
      migratedSlots.push(block.slot);
    }

    if (entries.length > 0) {
      await db.executionPayloadEnvelopeArchive.batchArchiveAndDeleteHot(entries);
    }
  }

  // Ancestor walk is newest to oldest; sort ascending so `prettyPrintIndices` renders cleanly.
  return migratedSlots.sort((a, b) => a - b);
}

/**
 * Source: unstable@0edec865c8 chain/archiveStore/utils/archiveBlocks.ts#getParentRootFromSignedBlock.
 *
 * ```
 * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 *
 * class BeaconBlock(Container):
 *   slot: Slot [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex [fixed - 8 bytes]
 *   parent_root: Root [fixed - 32 bytes]
 *   state_root: Root
 *   body: BeaconBlockBody
 * ```
 * From byte: `4 + 96 + 8 + 8 = 116`
 * To byte: `116 + 32 = 148`
 */
export function getParentRootFromSignedBlock(bytes: Uint8Array): Uint8Array {
  return bytes.slice(116, 148);
}
