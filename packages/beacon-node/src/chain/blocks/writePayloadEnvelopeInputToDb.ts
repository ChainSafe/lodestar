import {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {writeDataColumnsToDb} from "./writeBlockInputToDb.js";

/**
 * Source: unstable@1bf214377e chain/blocks/writePayloadEnvelopeInputToDb.ts.
 * [beacon-engine] Envelope persistence moved to chain/beaconEngine/importExecutionPayload.ts;
 * retain column reconstruction/persistence here, matching writeBlockInputToDb.ts.
 */
export async function writePayloadEnvelopeInputToDb(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput
): Promise<void> {
  const blockRootHex = payloadInput.blockRootHex;
  await writeDataColumnsToDb.call(this, payloadInput);
  this.logger.debug("Persisted payload columns to db", {
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
      "Error persisting payload columns",
      {
        slot: payloadInput.slot,
        root: payloadInput.blockRootHex,
      },
      e
    );
  });
}
