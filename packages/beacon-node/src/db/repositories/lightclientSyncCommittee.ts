import {IChainForkConfig} from "@lodestar/config";
import {Bucket, IDatabaseController, Repository} from "@lodestar/db";
import {altair, ssz} from "@lodestar/types";

/**
 * Historical sync committees by SyncCommittee hash tree root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeRepository extends Repository<Uint8Array, altair.SyncCommittee> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>) {
    super(config, db, Bucket.lightClient_syncCommittee, ssz.altair.SyncCommittee);
  }
}
