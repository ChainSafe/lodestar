import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {BeaconStateSnapshot, BeaconStateSnapshotType} from "../../chain/archiveStore/differentialState/ssz.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class BeaconStateSnapshotArchiveRepository extends Repository<Slot, BeaconStateSnapshot> {
  constructor(config: ChainForkConfig, db: Db) {
    const type = BeaconStateSnapshotType;
    const bucket = Bucket.allForks_beaconStateSnapshotArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  encodeValue(value: BeaconStateSnapshot): Uint8Array {
    return BeaconStateSnapshotType.serialize(value);
  }

  decodeValue(data: Uint8Array): BeaconStateSnapshot {
    return BeaconStateSnapshotType.deserializeToViewDU(data);
  }

  getId(state: BeaconStateSnapshot): Slot {
    return state.slot;
  }
}
