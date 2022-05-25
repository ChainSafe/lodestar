import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {ssz} from "@chainsafe/lodestar-types";
import {ContainerType, VectorCompositeType} from "@chainsafe/ssz";
import {SyncCommitteeWitness} from "../../chain/lightClient/types.js";

/**
 * Historical sync committees witness by block root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeWitnessRepository extends Repository<Uint8Array, SyncCommitteeWitness> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>, metrics?: IDbMetrics) {
    const type = new ContainerType({
      witness: new VectorCompositeType(ssz.Root, 4),
      currentSyncCommitteeRoot: ssz.Root,
      nextSyncCommitteeRoot: ssz.Root,
    });

    super(config, db, Bucket.lightClient_syncCommitteeWitness, type, metrics);
  }
}
