import {EventEmitter} from "events";

/**
 * The P2PNetwork service manages p2p connection/subscription objects
 */
export class P2PNetwork extends EventEmitter {
  public constructor(opts) {
    super();
    // build gossipsub object
  }
  public async start() {}
  public async stop() {}
}
