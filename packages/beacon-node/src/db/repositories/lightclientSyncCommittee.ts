import {ChainForkConfig} from "@lodestar/config";
import {Bucket, DatabaseController, Repository} from "@lodestar/db";
import {altair, ssz} from "@lodestar/types";

/**
 * Historical sync committees by SyncCommittee hash tree root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeRepository extends Repository<Uint8Array, altair.SyncCommittee> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    super(config, db, Bucket.lightClient_syncCommittee, ssz.altair.SyncCommittee);
  }
}
