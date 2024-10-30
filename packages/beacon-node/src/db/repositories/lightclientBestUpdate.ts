import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {LightClientUpdate, SyncPeriod, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const SLOT_BYTE_COUNT = 8;

/**
 * Best PartialLightClientUpdate in each SyncPeriod
 *
 * Used to prepare light client updates
 */
export class BestLightClientUpdateRepository extends Repository<SyncPeriod, LightClientUpdate> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    // Pick some type but won't be used
    const bucket = Bucket.lightClient_bestLightClientUpdate;
    super(config, db, bucket, ssz.altair.LightClientUpdate, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork
  encodeValue(value: LightClientUpdate): Uint8Array {
    // Not easy to have a fixed slot position for all forks in attested header, so lets
    // prefix by attestedHeader's slot bytes
    const slotBytes = ssz.Slot.serialize(value.attestedHeader.beacon.slot);
    const valueBytes = this.config
      .getLightClientForkTypes(value.attestedHeader.beacon.slot)
      .LightClientUpdate.serialize(value);

    const prefixedData = new Uint8Array(SLOT_BYTE_COUNT + valueBytes.length);
    prefixedData.set(slotBytes, 0);
    prefixedData.set(valueBytes, SLOT_BYTE_COUNT);

    return prefixedData;
  }

  decodeValue(data: Uint8Array): LightClientUpdate {
    // First slot is written
    const slot = ssz.Slot.deserialize(data.subarray(0, SLOT_BYTE_COUNT));
    return this.config.getLightClientForkTypes(slot).LightClientUpdate.deserialize(data.subarray(SLOT_BYTE_COUNT));
  }
}
