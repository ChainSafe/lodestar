import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, Slot, ssz} from "@lodestar/types";
import {getStateTypeFromBytes} from "../../util/multifork.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class SnapshotStateArchiveRepository extends Repository<Slot, BeaconStateAllForks> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const type = ssz.phase0.BeaconState as any;
    const bucket = Bucket.allForks_snapshotStateArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  encodeValue(value: BeaconStateAllForks): Uint8Array {
    return value.serialize();
  }

  decodeValue(data: Uint8Array): BeaconStateAllForks {
    return getStateTypeFromBytes(this.config, data).deserializeToViewDU(data);
  }

  getId(state: BeaconStateAllForks): Epoch {
    return state.slot;
  }
}
