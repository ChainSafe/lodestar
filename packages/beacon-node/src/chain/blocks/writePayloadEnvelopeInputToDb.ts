import {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {writeDataColumnsToDb} from "./writeBlockInputToDb.js";

/**
 * Persists payload envelope data to DB. This operation must be eventually completed if a payload is imported.
 *
 * TODO GLOAS: Persist envelope metadata (executionRequests, builderIndex, etc.) without the full
 * execution payload body — only keep the blockHash reference. The EL already stores the payload.
 * See https://github.com/ChainSafe/lodestar/issues/5671
 */
export async function writePayloadEnvelopeInputToDb(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput
): Promise<void> {
  const envelope = payloadInput.getPayloadEnvelope();
  const blockRootHex = payloadInput.blockRootHex;

  const envelopeBytes = this.serializedCache.get(envelope);
  const envelopePromise = envelopeBytes
    ? this.db.executionPayloadEnvelope.putBinary(this.db.executionPayloadEnvelope.getId(envelope), envelopeBytes)
    : this.db.executionPayloadEnvelope.add(envelope);

  // Write envelope and data columns in parallel (reuses shared column writing logic)
  await Promise.all([envelopePromise, writeDataColumnsToDb.call(this, payloadInput)]);
  this.logger.debug("Persisted payload envelope to db", {
    slot: payloadInput.slot,
    root: blockRootHex,
  });
}

export async function persistPayloadEnvelopeInput(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput
): Promise<void> {
  await writePayloadEnvelopeInputToDb.call(this, payloadInput).catch((e) => {
    this.logger.error(
      "Error persisting payload envelope in hot db",
      {
        slot: payloadInput.slot,
        root: payloadInput.blockRootHex,
      },
      e
    );
  });

  // The cache entry is intentionally left in place after DB persist. Several synchronous
  // consumers need to reach the envelope on every subsequent slot that extends the chain:
  //
  //   1. produceBlockBody.prepareExecutionPayload
  //      reads `seenPayloadEnvelopeInputCache.get(parentRoot)?.hasPayloadEnvelope()` to decide
  //      FULL vs EMPTY parent path, and then calls
  //      `getExpectedWithdrawalsForFullParent(payloadInput.getPayloadEnvelope())` to compute
  //      withdrawals for the FULL branch.
  //   2. chain.getParentExecutionRequests
  //      reads `payloadInput.getPayloadEnvelope().message.executionRequests` to include in the
  //      next block's `parentExecutionRequests` field for deferred payload processing.
  //   3. Gossip envelope handler (and other paths that see the same root again) rely on the
  //      `hasPayloadEnvelope()` signal being stable until finalization.
  //
  // Evicting per-root right after persist makes those consumers silently fall back to EMPTY,
  // which in testing cascaded into an all-EMPTY canonical chain and a stuck gloas range sync.
  //
  // `SeenPayloadEnvelopeInput.onFinalized` evicts entries whose slot is below the finalized
  // slot, bounding memory to roughly `finalization_distance * slot_cost` — UNDER NORMAL
  // FINALIZATION. Bulky per-entry data is the ~128 sampled data columns (~2KB each).
}
