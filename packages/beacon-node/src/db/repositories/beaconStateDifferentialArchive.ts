import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {BeaconStateDifferential, BeaconStateDifferentialType} from "../../chain/archiveStore/differentialState/ssz.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class BeaconStateDifferentialArchiveRepository extends Repository<Slot, BeaconStateDifferential> {
  constructor(config: ChainForkConfig, db: Db) {
    const type = BeaconStateDifferentialType;
    const bucket = Bucket.allForks_beaconStateDifferentialArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  encodeValue(value: BeaconStateDifferential): Uint8Array {
    return BeaconStateDifferentialType.serialize(value);
  }

  decodeValue(data: Uint8Array): BeaconStateDifferential {
    return BeaconStateDifferentialType.deserializeToViewDU(data);
  }

  getId(state: BeaconStateDifferential): Slot {
    return state.slot;
  }
}
