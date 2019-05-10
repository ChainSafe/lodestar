/**
 * @module sync
 */

import {EventEmitter} from "events";

/**
 * The Sync service handles everything related to receiving objects via p2p from other nodes
 * The strategy may differ depending on whether the chain is synced or not
 */
export class Sync extends EventEmitter {
  private network;

  public constructor(opts, {network}) {
    super();
    this.network = network;
  }
  public async start() {}
  public async stop() {}
}
