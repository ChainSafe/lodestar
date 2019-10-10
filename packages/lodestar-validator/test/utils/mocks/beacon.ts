import {BeaconBlock, BeaconState, bytes32, Fork, number64, SyncingStatus, uint64} from "@chainsafe/eth2.0-types";
import BN from "bn.js";
import {IBeaconApi} from "../../../src/api/interface/beacon";
import {getEmptyBlock} from "@chainsafe/lodestar/lib/chain/genesis/genesis";

export interface IMockBeaconApiOpts {
  version?: bytes32;
  fork?: Fork;
  head?: BeaconBlock;
  genesisTime?: number64;
}

export class MockBeaconApi implements IBeaconApi {
  private version: bytes32;
  private fork: Fork;
  private head: BeaconBlock;
  private genesisTime: number64;

  public constructor(opts?: IMockBeaconApiOpts) {
    this.version = opts && opts.version || Buffer.alloc(0);
    this.fork = opts && opts.fork
      || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0};
    this.head = opts && opts.head || getEmptyBlock();
    this.genesisTime = opts && opts.genesisTime || Date.now();
  }

  public async getClientVersion(): Promise<bytes32> {
    return this.version;
  }

  public async getFork(): Promise<{fork: Fork; chainId: uint64}> {
    return {fork: this.fork, chainId: new BN(1)};
  }

  public async getGenesisTime(): Promise<number64> {
    return this.genesisTime;
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
