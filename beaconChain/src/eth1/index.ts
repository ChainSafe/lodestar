import {EventEmitter} from "events";

export class Eth1Notifier extends EventEmitter {
  public depositContractAddress: string;

  public constructor(opts) {
    super();
    this.depositContractAddress = opts.depositContractAddress;
  }
  public async start() {}
  public async stop() {}
}
