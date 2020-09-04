import {Repository} from ".";
import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController} from "../../..";
import {Bucket} from "../../schema";

/**
 * States by root.
 * Although the interface is BeaconState.
 *
 * Used to store unfinalized states
 */
export class StateRepository extends Repository<Uint8Array, BeaconState> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.state, config.types.BeaconState);
  }

  /**
   * Id is hashTreeRoot of BeaconState
   */
  public getId(value: BeaconState): Uint8Array {
    return this.config.types.BeaconState.hashTreeRoot(value);
  }
}
