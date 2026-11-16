import {routes} from "@lodestar/api";
import {PayloadStatus} from "@lodestar/fork-choice";
import {NUMBER_OF_COLUMNS, isForkPostGloas} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {RootHex, gloas} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getGloasDataColumnSidecars} from "../../util/dataColumns.js";
import type {BeaconChain} from "../chain.js";
import {ChainEvent} from "../emitter.js";
import {BlockType, ProduceFullGloas} from "../produceBlock/index.js";
import {OpSource} from "../validatorMonitor.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "./payloadEnvelopeInput/index.js";

export enum SelfBuiltPayloadRevealStatus {
  /** The envelope and its data columns are being broadcast */
  publishing = "publishing",
  /** The envelope and its data columns were broadcast */
  published = "published",
}

/**
 * Reveal the execution payload of a block this node built itself.
 *
 * The envelope is not signed, so the node that built the payload does not need the validator client to release
 * it. It broadcasts the envelope and its data columns as soon as it has broadcast or imported the block, however
 * the block arrived (publish API or gossip), and imports the payload once the block is in fork choice.
 *
 * Must only be called for a block whose proposer signature was verified, after the block was broadcast and after
 * it was imported. The broadcast happens at most once per block root, unless it fails: the payload is then not
 * recorded as revealed and not added to the `PayloadEnvelopeInput`, so that a later call broadcasts it again and
 * the publish API still accepts the envelope from the validator client. Later calls otherwise only make sure the
 * payload gets imported. Does nothing for a block this node did not build, or built on a builder's bid, and
 * does not start to reveal the payload of a block from a slot that has passed.
 *
 * Never throws. Returns true if this call started the broadcast of the envelope.
 */
export function revealSelfBuiltPayload(this: BeaconChain, blockRootHex: RootHex): boolean {
  try {
    return maybeRevealSelfBuiltPayload.call(this, blockRootHex);
  } catch (e) {
    this.logger.error("Error revealing self-built execution payload", {blockRoot: blockRootHex}, e as Error);
    return false;
  }
}

function maybeRevealSelfBuiltPayload(this: BeaconChain, blockRootHex: RootHex): boolean {
  const produceResult = this.blockProductionCache.get(blockRootHex);
  if (
    produceResult === undefined ||
    !isForkPostGloas(produceResult.fork) ||
    produceResult.type !== BlockType.Full ||
    // Blocks committing to a builder bid are cached as full but without payload data
    (produceResult as ProduceFullGloas).executionPayload === undefined
  ) {
    return false;
  }

  // Seeded from the block before it is broadcast or imported, on every path
  const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
  if (payloadInput === undefined) {
    return false;
  }

  const status = this.selfBuiltPayloadReveals.get(blockRootHex);
  if (status === SelfBuiltPayloadRevealStatus.publishing) {
    // The payload is imported once it is broadcast
    return false;
  }

  if (status === SelfBuiltPayloadRevealStatus.published) {
    // The payload can only be imported once its block is in fork choice. If the block was broadcast before it was
    // imported, the call after the import gets here
    if (!payloadInput.hasPayloadEnvelope()) {
      // The PayloadEnvelopeInput was pruned and created again from the block after the reveal
      seedPayloadInput(payloadInput, buildSelfBuiltPayload(blockRootHex, produceResult as ProduceFullGloas));
    }
    importSelfBuiltPayload.call(this, payloadInput);
    return false;
  }

  // An envelope that is already there was received on gossip or submitted to the publish API by the validator
  // client, which broadcast and import it themselves
  if (payloadInput.hasPayloadEnvelope()) {
    return false;
  }

  // The payload of a late block is not revealed, it could only be seen after the slot it was built for
  const slot = payloadInput.slot;
  if (slot < this.clock.currentSlot) {
    this.logger.warn("Self-built block is from a past slot, not revealing its execution payload", {
      slot,
      currentSlot: this.clock.currentSlot,
      blockRoot: blockRootHex,
    });
    return false;
  }

  const selfBuiltPayload = buildSelfBuiltPayload(blockRootHex, produceResult as ProduceFullGloas);
  const {envelope, dataColumnSidecars} = selfBuiltPayload;
  const seenTimestampSec = Date.now() / 1000;
  const logCtx = {slot, blockRoot: blockRootHex, blockHash: toRootHex(envelope.payload.blockHash)};

  const onPublished = (error: Error | null): void => {
    try {
      if (error !== null) {
        // Not revealed. A later call tries again, and so does the validator client through the publish API
        this.selfBuiltPayloadReveals.delete(blockRootHex);
        this.logger.error("Error publishing self-built execution payload envelope", logCtx, error);
        return;
      }

      this.selfBuiltPayloadReveals.set(blockRootHex, SelfBuiltPayloadRevealStatus.published);

      const delaySec = seenTimestampSec - computeTimeAtSlot(this.config, slot, this.genesisTime);
      this.metrics?.gossipExecutionPayloadEnvelope.elapsedTimeTillReceived.observe({source: OpSource.api}, delaySec);
      this.validatorMonitor?.registerExecutionPayloadEnvelope(OpSource.api, delaySec, envelope);

      if (this.opts.persistProducedPayloadEnvelopes) {
        this.persistExecutionPayloadEnvelope(envelope);
      }

      this.logger.info("Revealed self-built execution payload envelope", {
        ...logCtx,
        dataColumns: dataColumnSidecars.length,
        delaySec,
      });

      this.emitter.emit(routes.events.EventType.executionPayloadGossip, {
        slot,
        builderIndex: payloadInput.getBuilderIndex(),
        blockHash: logCtx.blockHash,
        payloadRoot: payloadInput.getPayloadRootHex(),
        blockRoot: blockRootHex,
      });

      // The PayloadEnvelopeInput may have been pruned, and created again from the block, in the meantime
      const currentPayloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
      if (currentPayloadInput !== undefined) {
        seedPayloadInput(currentPayloadInput, selfBuiltPayload, seenTimestampSec);
        importSelfBuiltPayload.call(this, currentPayloadInput);
      }
    } catch (e) {
      this.logger.error("Error handling revealed self-built execution payload", logCtx, e as Error);
    }
  };

  this.logger.debug("Revealing self-built execution payload envelope", logCtx);

  if (this.emitter.listenerCount(ChainEvent.publishExecutionPayloadEnvelope) === 0) {
    throw Error("No publisher for the execution payload envelope");
  }

  this.selfBuiltPayloadReveals.set(blockRootHex, SelfBuiltPayloadRevealStatus.publishing);
  try {
    this.emitter.emit(ChainEvent.publishExecutionPayloadEnvelope, envelope, dataColumnSidecars, onPublished);
  } catch (e) {
    this.selfBuiltPayloadReveals.delete(blockRootHex);
    throw e;
  }

  return true;
}

type SelfBuiltPayload = {
  envelope: gloas.ExecutionPayloadEnvelope;
  dataColumnSidecars: gloas.DataColumnSidecar[];
};

function buildSelfBuiltPayload(blockRootHex: RootHex, produceResult: ProduceFullGloas): SelfBuiltPayload {
  const {executionPayload, executionRequests, blobsBundle, cells, parentBlockRoot} = produceResult;

  const envelope: gloas.ExecutionPayloadEnvelope = {
    payload: executionPayload,
    executionRequests,
    beaconBlockRoot: fromHex(blockRootHex),
    parentBeaconBlockRoot: parentBlockRoot,
  };

  const cellsAndProofs = cells.map((rowCells, rowIndex) => ({
    cells: rowCells,
    proofs: blobsBundle.proofs.slice(rowIndex * NUMBER_OF_COLUMNS, (rowIndex + 1) * NUMBER_OF_COLUMNS),
  }));
  const dataColumnSidecars = getGloasDataColumnSidecars(
    executionPayload.slotNumber,
    envelope.beaconBlockRoot,
    cellsAndProofs
  );

  return {envelope, dataColumnSidecars};
}

/** Give the `PayloadEnvelopeInput` the envelope and data columns of the revealed payload, unless it has them */
function seedPayloadInput(
  payloadInput: PayloadEnvelopeInput,
  {envelope, dataColumnSidecars}: SelfBuiltPayload,
  seenTimestampSec = Date.now() / 1000
): void {
  if (!payloadInput.hasPayloadEnvelope()) {
    payloadInput.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.api,
      seenTimestampSec,
      peerIdStr: undefined,
    });
  }
  for (const columnSidecar of dataColumnSidecars) {
    if (!payloadInput.hasColumn(columnSidecar.index)) {
      payloadInput.addColumn({
        columnSidecar,
        source: PayloadEnvelopeInputSource.api,
        seenTimestampSec,
        peerIdStr: undefined,
      });
    }
  }
}

function importSelfBuiltPayload(this: BeaconChain, payloadInput: PayloadEnvelopeInput): void {
  const blockRootHex = payloadInput.blockRootHex;
  if (
    this.forkChoice.hasBlockHex(blockRootHex) &&
    this.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL) === null
  ) {
    this.processExecutionPayload(payloadInput, {validEnvelope: false}).catch((e) => {
      this.logger.error(
        "Error importing self-built execution payload",
        {slot: payloadInput.slot, blockRoot: blockRootHex},
        e as Error
      );
    });
  }
}
