import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {DifferentialState, DifferentialStateType} from "../../chain/archiveStore/utils/differentialStateManager.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class DifferentialStateArchiveRepository extends Repository<Slot, DifferentialState> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const type = DifferentialStateType as any;
    const bucket = Bucket.allForks_differentialStateArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  encodeValue(value: DifferentialState): Uint8Array {
    return DifferentialStateType.serialize(value);
  }

  decodeValue(data: Uint8Array): DifferentialState {
    return DifferentialStateType.deserializeToViewDU(data);
  }

  getId(state: DifferentialState): Slot {
    return state.slot;
  }
}
