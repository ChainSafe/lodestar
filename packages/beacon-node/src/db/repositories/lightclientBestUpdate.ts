import {IChainForkConfig} from "@lodestar/config";
import {Bucket, IDatabaseController, Repository} from "@lodestar/db";
import {ssz, SyncPeriod, allForks} from "@lodestar/types";

import {getLightClientUpdateTypeFromBytes} from "../../util/multifork.js";

/**
 * Best PartialLightClientUpdate in each SyncPeriod
 *
 * Used to prepare light client updates
 */
export class BestLightClientUpdateRepository extends Repository<SyncPeriod, allForks.LightClientUpdate> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>) {
    // Pick some type but won't be used
    super(config, db, Bucket.lightClient_bestLightClientUpdate, ssz.altair.LightClientUpdate);
  }

  // Overrides for multi-fork
  encodeValue(value: allForks.LightClientUpdate): Uint8Array {
    return this.config
      .getLightClientForkTypes(value.attestedHeader.beacon.slot)
      .LightClientUpdate.serialize(value) as Uint8Array;
  }

  decodeValue(data: Uint8Array): allForks.LightClientUpdate {
    return getLightClientUpdateTypeFromBytes(this.config, data).deserialize(data);
  }
}
