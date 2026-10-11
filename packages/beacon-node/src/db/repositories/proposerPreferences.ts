import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
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
}
