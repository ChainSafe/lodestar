import {ContainerType, VectorCompositeType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {SyncCommitteeWitness} from "../../chain/lightClient/types.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

// We add a 1-byte prefix where 0 means pre-electra and 1 means post-electra
enum PrefixByte {
  PRE_ELECTRA = 0,
  POST_ELECTRA = 1,
}

export const NUM_WITNESS = 4;
export const NUM_WITNESS_ELECTRA = 5;

/**
 * Historical sync committees witness by block root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeWitnessRepository extends Repository<Uint8Array, SyncCommitteeWitness> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    const bucket = Bucket.lightClient_syncCommitteeWitness;
    // Pick some type but won't be used. Witness can be 4 or 5 so need to handle dynamically
    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, NUM_WITNESS),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork
  encodeValue(value: SyncCommitteeWitness): Uint8Array {
    const numWitness = value.witness.length;

    if (numWitness !== NUM_WITNESS && numWitness !== NUM_WITNESS_ELECTRA) {
      throw Error(`Number of witness can only be 4 pre-electra or 5 post-electra numWitness=${numWitness}`);
    }

    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, numWitness),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    const valueBytes = type.serialize(value);

    // We need to differentiate between post-electra and pre-electra witness
    // such that we can deserialize correctly
    const isPostElectra = numWitness === NUM_WITNESS_ELECTRA;
    const prefixByte = new Uint8Array(1);
    prefixByte[0] = isPostElectra ? PrefixByte.POST_ELECTRA : PrefixByte.PRE_ELECTRA;

    const prefixedData = new Uint8Array(1 + valueBytes.length);
    prefixedData.set(prefixByte, 0);
    prefixedData.set(valueBytes, 1);

    return prefixedData;
  }

  decodeValue(data: Uint8Array): SyncCommitteeWitness {
    // First byte is written
    const prefix = data.subarray(0, 1);
    const isPostElectra = prefix[0] === PrefixByte.POST_ELECTRA;

    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, isPostElectra ? NUM_WITNESS_ELECTRA : NUM_WITNESS),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    return type.deserialize(data.subarray(1));
  }
}
