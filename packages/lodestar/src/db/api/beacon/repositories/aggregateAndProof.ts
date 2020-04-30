import {AggregateAndProof} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * AggregateAndProof indexed by root
 */
export class AggregateAndProofRepository extends Repository<Uint8Array, AggregateAndProof> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>
  ) {
    super(config, db, Bucket.aggregateAndProof, config.types.AggregateAndProof);
  }
}
