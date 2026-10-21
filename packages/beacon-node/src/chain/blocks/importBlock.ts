import {routes} from "@lodestar/api";
import {ForkSeq} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {capella, isGloasBeaconBlock} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_BPS} from "../reprocess.js";
import {IBlockInput, isBlockInputBlobs, isBlockInputColumns} from "./blockInput/index.js";
import {ImportBlockOpts} from "./types.js";

/**
 * Emit eventstream events for block contents events only for blocks that are recent enough to clock
 */
const EVENTSTREAM_EMIT_RECENT_BLOCK_SLOTS = 64;

/**
 * Imports a fully verified block into the chain state. Produces multiple permanent side-effects.
 */
export async function importBlock(
  this: BeaconChain,
  blockInput: IBlockInput,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportBlockOpts
): Promise<void> {
  const block = blockInput.getBlock();
  const {slot: blockSlot} = block.message;
  const recvToValLatency = Date.now() / 1000 - (opts.seenTimestampSec ?? Date.now() / 1000);

  // this is just a type assertion since blockinput with dataPromise type will not end up here
  if (!blockInput.hasAllData) {
    throw Error("Unavailable block can not be imported in forkchoice");
  }

  // Persist column data asynchronously; the engine persists the block before fork-choice import.
  await this.unfinalizedBlockWrites.waitForSpace();
  this.unfinalizedBlockWrites.push(blockInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error("Error pushing block to unfinalized write queue", {slot: blockSlot}, e as Error);
    }
  });

  // 2-5. Delegate to engine: state transition, fork choice, head computation.
  // The main-thread engine retains the input; its core takes only the root as bytes.
  // [beacon-engine] moved: consensus import, addAttestationPreElectra/addAttestationPostElectra,
  // and import FCU now live in packages/beacon-node/src/chain/beaconEngine/importBlock.ts.
  // On unstable merges, sync that logic there; retain facade side effects here.
  const r = await this.beaconEngine.importBlock(blockInput, dataAvailabilityStatus, opts);

  this.metrics?.importBlock.bySource.inc({source: blockInput.getBlockSource().source});
  if (isBlockInputColumns(blockInput)) {
    for (const {source} of blockInput.getSampledColumnsWithSource()) {
      this.metrics?.dataColumns.bySource.inc({source});
    }
  } else if (isBlockInputBlobs(blockInput)) {
    for (const {source} of blockInput.getAllBlobsWithSource()) {
      this.metrics?.importBlock.blobsBySource.inc({blobsSource: source});
    }
  }

  // [beacon-engine] moved: head/reorg events are emitted by engine fork-choice transitions.
  if (this.config.getForkSeq(blockSlot) >= ForkSeq.gloas) {
    callInNextEventLoop(() => {
      const parent = this.getBlockHexDefaultStatus(r.newHead.parentRoot);
      if (parent) this.seenPayloadEnvelopeInputCache.pruneBelowParent(parent);
    });
  }

  const blockRootHex = r.blockMeta.blockRootHex;
  const blockSummary = r.blockSummary;

  if (this.clock.currentSlot - blockSlot < EVENTSTREAM_EMIT_RECENT_BLOCK_SLOTS) {
    callInNextEventLoop(() => {
      if (this.emitter.listenerCount(routes.events.EventType.block)) {
        this.emitter.emit(routes.events.EventType.block, {
          block: blockRootHex,
          slot: blockSlot,
          executionOptimistic: blockSummary != null && isOptimisticBlock(blockSummary),
          ...(isGloasBeaconBlock(block.message) && {
            blockHash: toRootHex(block.message.body.signedExecutionPayloadBid.message.blockHash),
            builderIndex: block.message.body.signedExecutionPayloadBid.message.builderIndex,
          }),
        });
      }
      if (this.emitter.listenerCount(routes.events.EventType.voluntaryExit)) {
        for (const voluntaryExit of block.message.body.voluntaryExits) {
          this.emitter.emit(routes.events.EventType.voluntaryExit, voluntaryExit);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.blsToExecutionChange)) {
        for (const blsToExecutionChange of (block.message as capella.BeaconBlock).body.blsToExecutionChanges ?? []) {
          this.emitter.emit(routes.events.EventType.blsToExecutionChange, blsToExecutionChange);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.attestation)) {
        for (const attestation of block.message.body.attestations) {
          this.emitter.emit(routes.events.EventType.attestation, attestation);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.attesterSlashing)) {
        for (const attesterSlashing of block.message.body.attesterSlashings) {
          this.emitter.emit(routes.events.EventType.attesterSlashing, attesterSlashing);
        }
      }
      if (this.emitter.listenerCount(routes.events.EventType.proposerSlashing)) {
        for (const proposerSlashing of block.message.body.proposerSlashings) {
          this.emitter.emit(routes.events.EventType.proposerSlashing, proposerSlashing);
        }
      }
    });
  }

  const reprocessGuardSec =
    this.config.getSlotComponentDurationMs(this.config.getForkName(blockSlot), REPROCESS_MIN_TIME_TO_NEXT_SLOT_BPS) /
    1000;
  const advancedSlot = this.clock.slotWithFutureTolerance(reprocessGuardSec);
  callInNextEventLoop(() => {
    this.reprocessController.onBlockImported({slot: blockSlot, root: blockRootHex}, advancedSlot);
  });

  if (opts.seenTimestampSec !== undefined) {
    const recvToValidation = Date.now() / 1000 - opts.seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    this.metrics?.gossipBlock.blockImport.recvToValidation.observe(recvToValidation);
    this.metrics?.gossipBlock.blockImport.validationTime.observe(validationTime);

    this.logger.debug("Imported block", {slot: blockSlot, recvToValLatency, recvToValidation, validationTime});
  }

  this.logger.verbose("Block processed", {
    slot: blockSlot,
    root: blockRootHex,
    delaySec: this.clock.secFromSlot(blockSlot),
  });
}

// Upstream policy helper is shared by the facade segment filter and engine import.
export {importsBlockAttestations} from "../beaconEngine/importBlock.js";
