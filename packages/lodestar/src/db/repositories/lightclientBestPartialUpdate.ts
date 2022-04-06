import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {FINALIZED_ROOT_DEPTH} from "@chainsafe/lodestar-params";
import {ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {BooleanType, ContainerType, VectorCompositeType} from "@chainsafe/ssz";
import {PartialLightClientUpdate} from "../../chain/lightClient/types.js";

/**
 * Best PartialLightClientUpdate in each SyncPeriod
 *
 * Used to prepare light client updates
 */
export class BestPartialLightClientUpdateRepository extends Repository<SyncPeriod, PartialLightClientUpdate> {
  typeFinalized = new ContainerType({
    // isFinalized: true
    isFinalized: new BooleanType(),
    attestedHeader: ssz.phase0.BeaconBlockHeader,
    blockRoot: ssz.Root,
    finalityBranch: new VectorCompositeType(ssz.Root, FINALIZED_ROOT_DEPTH),
    finalizedCheckpoint: ssz.phase0.Checkpoint,
    finalizedHeader: ssz.phase0.BeaconBlockHeader,
    syncAggregate: ssz.altair.SyncAggregate,
  });

  typeNonFinalized = new ContainerType({
    // isFinalized: false
    isFinalized: new BooleanType(),
    attestedHeader: ssz.phase0.BeaconBlockHeader,
    blockRoot: ssz.Root,
    syncAggregate: ssz.altair.SyncAggregate,
  });

  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>, metrics?: IDbMetrics) {
    // super.type will not be used
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(config, db, Bucket.lightClient_bestPartialLightClientUpdate, ssz.altair.LightClientUpdate as any, metrics);
  }

  encodeValue(value: PartialLightClientUpdate): Uint8Array {
    if (value.isFinalized) {
      return this.typeFinalized.serialize(value);
    } else {
      return this.typeNonFinalized.serialize(value);
    }
  }

  decodeValue(data: Uint8Array): PartialLightClientUpdate {
    const firstByte = data[0];
    if (firstByte === 1) {
      return this.typeFinalized.deserialize(data);
    } else {
      return this.typeNonFinalized.deserialize(data) as PartialLightClientUpdate;
    }
  }
}
