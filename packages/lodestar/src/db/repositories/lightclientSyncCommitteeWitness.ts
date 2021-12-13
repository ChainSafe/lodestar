import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {ssz} from "@chainsafe/lodestar-types";
import {ContainerType, VectorType} from "@chainsafe/ssz";
import {SyncCommitteeWitness} from "../../chain/lightClient/types";

/**
 * Historical sync committees witness by block root
 *
 * Used to prepare lightclient updates and initial snapshots
 */
export class SyncCommitteeWitnessRepository extends Repository<Uint8Array, SyncCommitteeWitness> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>, metrics?: IDbMetrics) {
    const type = new ContainerType<SyncCommitteeWitness>({
      fields: {
        witness: new VectorType<Uint8Array[]>({length: 4, elementType: ssz.Root}),
        currentSyncCommitteeRoot: ssz.Root,
        nextSyncCommitteeRoot: ssz.Root,
      },
    });

    super(config, db, Bucket.lightClient_syncCommitteeWitness, type, metrics);
  }
}
