import {EventEmitter} from "events";

export class Sync extends EventEmitter {
  private network;

  public constructor(opts, {network}) {
    super();
    this.network = network;
  }
  public async start() {}
  public async stop() {}
}
