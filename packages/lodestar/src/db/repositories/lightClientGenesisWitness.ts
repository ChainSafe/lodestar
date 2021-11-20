import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {ssz} from "@chainsafe/lodestar-types";
import {VectorType} from "@chainsafe/ssz";
import {GenesisWitness} from "../../chain/lightClient/types";

/**
 * Genesis witness branch by block root
 *
 * Used to prepare lightclient init proofs
 */
export class GenesisWitnessRepository extends Repository<Uint8Array, GenesisWitness> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>, metrics?: IDbMetrics) {
    const type = new VectorType<GenesisWitness>({length: 4, elementType: ssz.Root});
    super(config, db, Bucket.lightClient_genesisWitness, type, metrics);
  }
}
