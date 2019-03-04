import {EventEmitter} from "events";

export class BeaconChain extends EventEmitter {
  public chain: string;

  public constructor(opts) {
    super();
    this.chain = opts.chain;
  }
  public async start() {}
  public async stop() {}
}
