import {routes} from "@lodestar/api";
import {BlockExecutionStatus, PayloadExecutionStatus} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {capella} from "@lodestar/types";
import {fromHex, isErrorAborted} from "@lodestar/utils";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "../reprocess.js";
import {IBlockInput} from "./blockInput/index.js";
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
  executionStatus: BlockExecutionStatus | PayloadExecutionStatus,
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

  // 1. Persist block to hot DB (performed asynchronously to avoid blocking head selection)
  await this.unfinalizedBlockWrites.waitForSpace();
  this.unfinalizedBlockWrites.push(blockInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error("Error pushing block to unfinalized write queue", {slot: blockSlot}, e as Error);
    }
  });

  // 2-5. Delegate to engine: state transition, fork choice, head computation.
  // Engine takes the root as bytes (native-engine bytes-first contract).
  const r = await this.beaconEngine.importBlock(
    fromHex(blockInput.blockRootHex),
    executionStatus,
    dataAvailabilityStatus,
    opts
  );

  // Emit head event (engine already pruned pools, registered seen-attesters, and set head state)
  if (r.head !== null) {
    try {
      this.emitter.emit(routes.events.EventType.head, r.head);
    } catch (e) {
      this.logger.debug("Error emitting head event", {slot: r.head.slot, root: r.head.block}, e as Error);
    }
  }

  // Emit chain reorg event
  if (r.reorg !== null) {
    this.emitter.emit(routes.events.EventType.chainReorg, r.reorg);
    this.logger.verbose("Chain reorg", r.reorg);
  }

  // Refresh the facade head cache and emit forkChoiceJustified/forkChoiceFinalized from the new head.
  // The engine no longer emits these (FFI-honest); they are derived facade-side from the head ProtoBlock.
  this.updateHeadAndEmitCheckpointEvents(r.newHead);

  // 6. Fire notifyForkchoiceUpdate on the EL. The engine computed the override decision + all hashes
  // internally (fork choice + proposer cache are engine-owned) and returned them as `r.fcuUpdate`;
  // the facade only fires the EL call (executionEngine is facade-owned) or skips. `disableImportExecutionFcU`
  // stays a facade-side gate.
  if (!this.opts.disableImportExecutionFcU && r.fcuUpdate !== null) {
    const {fork, headBlockHash, safeBlockHash, finalizedBlockHash} = r.fcuUpdate;
    this.executionEngine.notifyForkchoiceUpdate(fork, headBlockHash, safeBlockHash, finalizedBlockHash).catch((e) => {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.logger.error("Error pushing notifyForkchoiceUpdate()", {headBlockHash, finalizedBlockHash}, e);
      }
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

  const advancedSlot = this.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);
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
