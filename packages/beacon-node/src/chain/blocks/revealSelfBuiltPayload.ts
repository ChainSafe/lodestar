import {routes} from "@lodestar/api";
import {PayloadStatus} from "@lodestar/fork-choice";
import {NUMBER_OF_COLUMNS, isForkPostGloas} from "@lodestar/params";
import {RootHex, gloas} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getGloasDataColumnSidecars} from "../../util/dataColumns.js";
import type {BeaconChain} from "../chain.js";
import {ChainEvent} from "../emitter.js";
import {BlockType, ProduceFullGloas} from "../produceBlock/index.js";
import {PayloadEnvelopeInputSource} from "./payloadEnvelopeInput/index.js";

/**
 * Reveal the execution payload of a block this node built itself.
 *
 * The envelope is not signed, so the node that built the payload does not need the validator client to release
 * it. It broadcasts the envelope and its data columns as soon as it has broadcast or imported the block, however
 * the block arrived (publish API or gossip), and imports the payload once the block is in fork choice.
 *
 * Must be called after the block was broadcast and after it was imported. The broadcast happens at most once per
 * block root, later calls only make sure the payload gets imported. Does nothing for a block this node did not
 * build, or built on a builder's bid.
 *
 * Returns true if the envelope was broadcast by this call.
 */
export function revealSelfBuiltPayload(this: BeaconChain, blockRootHex: RootHex): boolean {
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

  let revealed = false;
  // An envelope that is already there was published through the API, which broadcasts it itself
  if (!this.revealedSelfBuiltPayloads.has(blockRootHex) && !payloadInput.hasPayloadEnvelope()) {
    this.revealedSelfBuiltPayloads.add(blockRootHex);
    revealed = true;

    const {executionPayload, executionRequests, blobsBundle, cells, parentBlockRoot} =
      produceResult as ProduceFullGloas;
    const slot = executionPayload.slotNumber;
    const seenTimestampSec = Date.now() / 1000;

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
    const dataColumnSidecars = getGloasDataColumnSidecars(slot, envelope.beaconBlockRoot, cellsAndProofs);

    payloadInput.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.api,
      seenTimestampSec,
      peerIdStr: undefined,
    });
    for (const columnSidecar of dataColumnSidecars) {
      payloadInput.addColumn({
        columnSidecar,
        source: PayloadEnvelopeInputSource.api,
        seenTimestampSec,
        peerIdStr: undefined,
      });
    }

    if (this.opts.persistProducedPayloadEnvelopes) {
      this.persistExecutionPayloadEnvelope(envelope);
    }

    this.logger.info("Revealing self-built execution payload envelope", {
      slot,
      blockRoot: blockRootHex,
      blockHash: toRootHex(executionPayload.blockHash),
      dataColumns: dataColumnSidecars.length,
    });

    // Gossip the envelope first, then its data columns
    this.emitter.emit(ChainEvent.publishExecutionPayloadEnvelope, envelope);
    if (dataColumnSidecars.length > 0) {
      this.emitter.emit(ChainEvent.publishDataColumns, dataColumnSidecars);
    }

    this.emitter.emit(routes.events.EventType.executionPayloadGossip, {
      slot,
      builderIndex: payloadInput.getBuilderIndex(),
      blockHash: toRootHex(executionPayload.blockHash),
      blockRoot: blockRootHex,
    });
  }

  // The payload can only be imported once its block is in fork choice. If the block was broadcast before it was
  // imported, the call after the import gets here
  if (
    this.revealedSelfBuiltPayloads.has(blockRootHex) &&
    payloadInput.hasPayloadEnvelope() &&
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

  return revealed;
}
