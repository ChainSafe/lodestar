import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {getGloasMessageTypes} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * SignedProposerPreferences indexed by proposal slot and dependent root
 *
 * Added via gossip or api
 * Removed once the proposal slot has passed
 */
export class ProposerPreferencesRepository extends Repository<Uint8Array, gloas.SignedProposerPreferences> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloas_proposerPreferences;
    super(config, db, bucket, ssz.gloas.SignedProposerPreferences, getBucketNameByValue(bucket));
  }

  getId(value: gloas.SignedProposerPreferences): Uint8Array {
    const {proposalSlot, dependentRoot} = value.message;
    return Buffer.concat([intToBytes(proposalSlot, 8, "be"), dependentRoot]);
  }

  encodeValue(value: gloas.SignedProposerPreferences): Uint8Array {
    return getGloasMessageTypes(this.config, value.message.proposalSlot).SignedProposerPreferences.serialize(value);
  }

  // Fixed size, and the size says which scheme signed
  decodeValue(data: Uint8Array): gloas.SignedProposerPreferences {
    const type =
      data.length === ssz.pq.SignedProposerPreferences.fixedSize
        ? ssz.pq.SignedProposerPreferences
        : ssz.gloas.SignedProposerPreferences;
    return type.deserialize(data);
  }
}
