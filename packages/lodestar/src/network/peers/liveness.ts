import {IService} from "../../node/nodejs";

export class PeerLivenessMonitor implements IService {
  public async start(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async stop(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
