import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {ssz, allForks} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {getLightClientHeaderTypeFromBytes} from "../../util/multifork.js";

/**
 * Block headers by block root. Until finality includes all headers seen by this node. After finality,
 * all non-checkpoint headers are pruned from this repository.
 *
 * Used to prepare light client updates
 */
export class CheckpointHeaderRepository extends Repository<Uint8Array, allForks.LightClientHeader> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    // Pick some type but won't be used
    const bucket = Bucket.lightClient_checkpointHeader;
    super(config, db, bucket, ssz.altair.LightClientHeader, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork
  encodeValue(value: allForks.LightClientHeader): Uint8Array {
    return this.config.getLightClientForkTypes(value.beacon.slot).LightClientHeader.serialize(value);
  }

  decodeValue(data: Uint8Array): allForks.LightClientHeader {
    return getLightClientHeaderTypeFromBytes(this.config, data).deserialize(data);
  }
}
