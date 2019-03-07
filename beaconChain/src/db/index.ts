import {EventEmitter} from "events";

import {
  BeaconState,
} from "../types";

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
    return {} as BeaconState;
  }

  /**
   * Set the canonical beacon chain's state
   * @param {BeaconState} state
   */
  public set state(state: BeaconState) {
  }
}
