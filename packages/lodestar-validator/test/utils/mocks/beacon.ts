import {
  BeaconBlock,
  BeaconState,
  Bytes32,
  Fork,
  Number64,
  SyncingStatus,
  Root,
  Uint64
} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "../../../src/api/interface/beacon";
import {generateEmptyBlock} from "../block";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";

export interface IMockBeaconApiOpts {
  version?: Bytes32;
  fork?: Fork;
  head?: BeaconBlock;
  genesisTime?: Number64;
}

export class MockBeaconApi implements IBeaconApi {
  private version: Bytes32;
  private fork: Fork;
  private head: BeaconBlock;
  private genesisTime: Number64;

  public constructor(opts?: IMockBeaconApiOpts) {
    this.version = opts && opts.version || Buffer.alloc(0);
    this.fork = opts && opts.fork
      || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0};
    this.head = opts && opts.head || generateEmptyBlock();
    this.genesisTime = (opts && opts.genesisTime) || (Date.now() / 1000);
  }

  public async getValidator(): Promise<any> {
    throw new Error("Method not implemented.");
  }

  public async getClientVersion(): Promise<Bytes32> {
    return this.version;
  }

  public async getFork(): Promise<{fork: Fork; chainId: Uint64; genesisValidatorsRoot: Root}> {
    return {fork: this.fork, chainId: 1n, genesisValidatorsRoot: ZERO_HASH};
  }

  public async getGenesisTime(): Promise<Number64> {
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
