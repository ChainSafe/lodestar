import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {phase0, ssz} from "@chainsafe/lodestar-types";

/**
 * Block headers by block root
 *
 * Used to prepare light client updates
 */
export class FinalizedHeaderRepository extends Repository<Uint8Array, phase0.BeaconBlockHeader> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>, metrics?: IDbMetrics) {
    super(config, db, Bucket.lightClient_finalizedHeader, ssz.phase0.BeaconBlockHeader, metrics);
  }
}
