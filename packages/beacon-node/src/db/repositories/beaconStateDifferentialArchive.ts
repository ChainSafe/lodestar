import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {BeaconStateDifferential, BeaconStateDifferentialType} from "../../chain/archiveStore/differentialState/ssz.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class BeaconStateDifferentialArchiveRepository extends Repository<Slot, BeaconStateDifferential> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const type = BeaconStateDifferentialType as any;
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
