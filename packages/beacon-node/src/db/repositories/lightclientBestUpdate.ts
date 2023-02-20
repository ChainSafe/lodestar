import {ChainForkConfig} from "@lodestar/config";
import {Bucket, DatabaseController, Repository} from "@lodestar/db";
import {ssz, SyncPeriod, allForks} from "@lodestar/types";

const SLOT_BYTE_COUNT = 8;

/**
 * Best PartialLightClientUpdate in each SyncPeriod
 *
 * Used to prepare light client updates
 */
export class BestLightClientUpdateRepository extends Repository<SyncPeriod, allForks.LightClientUpdate> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    // Pick some type but won't be used
    super(config, db, Bucket.lightClient_bestLightClientUpdate, ssz.altair.LightClientUpdate);
  }

  // Overrides for multi-fork
  encodeValue(value: allForks.LightClientUpdate): Uint8Array {
    // Not easy to have a fixed slot position for all forks in attested header, so lets
    // prefix by attestedHeader's slot bytes
    const slotBytes = ssz.Slot.serialize(value.attestedHeader.beacon.slot) as Uint8Array;
    const valueBytes = this.config
      .getLightClientForkTypes(value.attestedHeader.beacon.slot)
      .LightClientUpdate.serialize(value) as Uint8Array;

    const prefixedData = new Uint8Array(SLOT_BYTE_COUNT + valueBytes.length);
    prefixedData.set(slotBytes, 0);
    prefixedData.set(valueBytes, SLOT_BYTE_COUNT);

    return prefixedData;
  }

  decodeValue(data: Uint8Array): allForks.LightClientUpdate {
    // First slot is written
    const slot = ssz.Slot.deserialize(data.subarray(0, SLOT_BYTE_COUNT));
    return this.config.getLightClientForkTypes(slot).LightClientUpdate.deserialize(data.subarray(SLOT_BYTE_COUNT));
  }
}
