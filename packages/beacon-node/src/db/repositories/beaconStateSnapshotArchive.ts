import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {BeaconStateSnapshot, BeaconStateSnapshotType} from "../../chain/archiveStore/differentialState/ssz.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class BeaconStateSnapshotArchiveRepository extends Repository<Slot, BeaconStateSnapshot> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const type = BeaconStateSnapshotType as any;
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
