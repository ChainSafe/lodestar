import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {getGloasMessageTypes} from "@lodestar/state-transition";
import {Root, gloas, ssz} from "@lodestar/types";
import {getSlotFromExecutionPayloadEnvelopeSerialized} from "../../util/sszBytes.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

type BlockRoot = Root;

/**
 * Used to store unfinalized `SignedExecutionPayloadEnvelope`
 *
 * Indexed by beacon block root (root of the beacon block that contains the bid)
 */
export class ExecutionPayloadEnvelopeRepository extends Repository<BlockRoot, gloas.SignedExecutionPayloadEnvelope> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_executionPayloadEnvelope;
    super(config, db, bucket, ssz.gloas.SignedExecutionPayloadEnvelope, getBucketNameByValue(bucket));
  }

  /**
   * Id is the beacon block root (not execution payload hash)
   * This allows correlation with the block that contains the bid
   */
  getId(value: gloas.SignedExecutionPayloadEnvelope): BlockRoot {
    return value.message.beaconBlockRoot;
  }

  encodeValue(value: gloas.SignedExecutionPayloadEnvelope): Uint8Array {
    return getGloasMessageTypes(this.config, value.message.payload.slotNumber).SignedExecutionPayloadEnvelope.serialize(
      value
    );
  }

  decodeValue(data: Uint8Array): gloas.SignedExecutionPayloadEnvelope {
    const slot = getSlotFromExecutionPayloadEnvelopeSerialized(data);
    if (slot === null) throw Error("Stored execution payload envelope is too short");
    return getGloasMessageTypes(this.config, slot).SignedExecutionPayloadEnvelope.deserialize(data);
  }
}
