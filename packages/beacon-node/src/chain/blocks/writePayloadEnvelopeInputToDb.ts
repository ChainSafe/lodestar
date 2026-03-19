import {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {writeDataColumnsToDb} from "./writeBlockInputToDb.js";

/**
 * Persists payload envelope data to DB. This operation must be eventually completed if a payload is imported.
 *
 * TODO GLOAS: Persist envelope metadata (stateRoot, executionRequests, builderIndex, etc.) without the full
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
  await writePayloadEnvelopeInputToDb
    .call(this, payloadInput)
    .catch((e) => {
      this.logger.error(
        "Error persisting payload envelope in hot db",
        {
          slot: payloadInput.slot,
          root: payloadInput.blockRootHex,
        },
        e
      );
    })
    .finally(() => {
      this.seenPayloadEnvelopeInput.prune(payloadInput.blockRootHex);
      this.logger.debug("Pruned payload envelope input", {
        slot: payloadInput.slot,
        root: payloadInput.blockRootHex,
      });
    });
}
