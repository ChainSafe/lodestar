import {fromHex} from "@lodestar/utils";
import {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";

/**
 * Persists payload envelope data to DB. This operation must be eventually completed if a payload is imported.
 * Else the node will be in an inconsistent state that can lead to being stuck.
 *
 * This operation may be performed before, during or after importing to the fork choice. As long as errors
 * are handled properly for eventual consistency.
 */
export async function writePayloadEnvelopeInputToDb(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput
): Promise<void> {
  const envelope = payloadInput.getPayloadEnvelope();
  const blockRootHex = payloadInput.blockRootHex;
  const blockRoot = fromHex(blockRootHex);

  const fnPromises: Promise<void>[] = [];

  const envelopeBytes = this.serializedCache.get(envelope);
  if (envelopeBytes) {
    fnPromises.push(
      this.db.executionPayloadEnvelope.putBinary(this.db.executionPayloadEnvelope.getId(envelope), envelopeBytes)
    );
  } else {
    fnPromises.push(this.db.executionPayloadEnvelope.add(envelope));
  }

  // payloadInput.isComplete() must be true in order to reach this function.
  // So we should have all kzg commitments here.
  const blobsLen = payloadInput.getBlobKzgCommitments().length;
  if (blobsLen > 0) {
    const {custodyColumns} = this.custodyConfig;
    const dataColumnSidecars = payloadInput.getCustodyColumns();

    const binaryPuts = [];
    const nonbinaryPuts = [];
    for (const dataColumnSidecar of dataColumnSidecars) {
      const serialized = this.serializedCache.get(dataColumnSidecar);
      if (serialized) {
        binaryPuts.push({key: dataColumnSidecar.index, value: serialized});
      } else {
        nonbinaryPuts.push(dataColumnSidecar);
      }
    }
    fnPromises.push(this.db.dataColumnSidecar.putManyBinary(blockRoot, binaryPuts));
    fnPromises.push(this.db.dataColumnSidecar.putMany(blockRoot, nonbinaryPuts));

    this.logger.debug("Persisting payload dataColumnSidecars to hot DB", {
      slot: payloadInput.slot,
      root: blockRootHex,
      dataColumnSidecars: dataColumnSidecars.length,
      numBlobs: blobsLen,
      custodyColumns: custodyColumns.length,
    });
  }

  await Promise.all(fnPromises);
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
      this.seenPayloadEnvelopeInput.delete(payloadInput.blockRootHex);
      // Without forcefully clearing this cache, we would rely on WeakMap to evict memory which is not reliable.
      // Clear here (after the DB write) so that writePayloadEnvelopeInputToDb can still use the cached serialized bytes.
      this.serializedCache.clear();
      this.logger.debug("Pruned payload envelope input", {
        slot: payloadInput.slot,
        root: payloadInput.blockRootHex,
      });
    });
}
