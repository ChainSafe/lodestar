import {BeaconBlock, Bytes32, Fork, Genesis, Number64} from "@chainsafe/lodestar-types";
import {IBeaconApiClient} from "../../../src/api/types";
import {generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";

export interface IMockBeaconApiOpts {
  version?: Bytes32;
  fork?: Fork;
  head?: BeaconBlock;
  genesisTime?: Number64;
}

export class MockBeaconApi implements IBeaconApiClient {
  private version: Bytes32;
  private fork: Fork;
  private head: BeaconBlock;
  private genesisTime: Number64;

  public constructor(opts?: IMockBeaconApiOpts) {
    this.version = (opts && opts.version) || Buffer.alloc(0);
    this.fork = (opts && opts.fork) || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0};
    this.head = (opts && opts.head) || generateEmptyBlock();
    this.genesisTime = (opts && opts.genesisTime) || Math.floor(Date.now() / 1000);
  }

  public async getValidator(): Promise<any> {
    throw new Error("Method not implemented.");
  }

  public async getFork(): Promise<Fork | null> {
    return this.fork;
  }

  public async getGenesis(): Promise<Genesis | null> {
    return {
      genesisTime: BigInt(this.genesisTime),
      genesisForkVersion: Buffer.alloc(8, 1),
      genesisValidatorsRoot: Buffer.alloc(32, 1),
    };
  }
}
