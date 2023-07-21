import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {altair, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Historical sync committees by SyncCommittee hash tree root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeRepository extends Repository<Uint8Array, altair.SyncCommittee> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    const bucket = Bucket.lightClient_syncCommittee;
    super(config, db, bucket, ssz.altair.SyncCommittee, getBucketNameByValue(bucket));
  }
}
