import {EventEmitter} from "events";

/**
 * The Eth1Notifier service watches the Eth1.0 chain for relevant events
 */
export class Eth1Notifier extends EventEmitter {
  public depositContractAddress: string;

  public constructor(opts) {
    super();
    this.depositContractAddress = opts.depositContractAddress;
  }
  public async start() {}
  public async stop() {}
}
