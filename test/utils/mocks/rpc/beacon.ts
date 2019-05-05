import {IBeaconApi} from "../../../../src/rpc/api/beacon";
import {BeaconBlock, BeaconState, bytes32, Fork, number64, SyncingStatus} from "../../../../src/types";
import {getEmptyBlock} from "../../../../src/chain/genesis";

export interface MockBeaconApiOpts {
  version?: bytes32;
  fork?: Fork;
  head?: BeaconBlock;
}

export class MockBeaconApi implements IBeaconApi {

  public namespace: string;
  private version: bytes32;
  private fork: Fork;
  private head: BeaconBlock;

  public constructor(opts?: MockBeaconApiOpts) {
    this.namespace = 'beacon';
    this.version = opts && opts.version || Buffer.alloc(0);
    this.fork = opts && opts.fork
      || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0};
    this.head = opts && opts.head || getEmptyBlock();
  }

  public async getClientVersion(): Promise<bytes32> {
    return this.version;
  }

  public async getFork(): Promise<Fork> {
    return this.fork;
  }

  public async getGenesisTime(): Promise<number64> {
    // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
    return {} as number64;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    return false;
  }

  public async getChainHead(): Promise<BeaconBlock> {
    return this.head;
  }

  public async getBeaconState(): Promise<BeaconState> {
    throw new Error("Method not implemented.");
  }

}
