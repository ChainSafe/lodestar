import {EventEmitter} from "events";

import {
  BeaconState,
} from "../types";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine, but instead expose relevent beacon chain objects
 */
export class DB extends EventEmitter {
  public constructor(opts) {
    super();
  }
  public async start() {}
  public async stop() {}

  /**
   * Fetch the canonical beacon chain's state
   * @returns {BeaconState}
   */
  public get state(): BeaconState {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as BeaconState;
  }

  /**
   * Set the canonical beacon chain's state
   * @param {BeaconState} state
   */
  public set state(state: BeaconState) {
  }
}
