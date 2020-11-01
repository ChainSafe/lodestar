import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {
  BeaconBlock,
  BeaconState,
  Bytes32,
  Fork,
  Genesis,
  Number64,
  Root,
  SyncingStatus,
  Uint64,
} from "@chainsafe/lodestar-types";
import {generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";
import sinon, {SinonStubbedInstance} from "sinon";
import {IBeaconApi, IBeaconStateApi} from "../../../src/api/interface/beacon";
import {RestBeaconStateApi} from "../../../src/api/impl/rest/beacon/state";

export interface IMockBeaconApiOpts {
  version?: Bytes32;
  fork?: Fork;
  head?: BeaconBlock;
  genesisTime?: Number64;
}

export class MockBeaconApi implements IBeaconApi {
  public state: SinonStubbedInstance<IBeaconStateApi>;

  private version: Bytes32;
  private fork: Fork;
  private head: BeaconBlock;
  private genesisTime: Number64;

  public constructor(opts?: IMockBeaconApiOpts) {
    this.version = (opts && opts.version) || Buffer.alloc(0);
    this.fork = (opts && opts.fork) || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0};
    this.head = (opts && opts.head) || generateEmptyBlock();
    this.genesisTime = (opts && opts.genesisTime) || Math.floor(Date.now() / 1000);
    this.state = sinon.createStubInstance(RestBeaconStateApi);
  }

  public async getValidator(): Promise<any> {
    throw new Error("Method not implemented.");
  }

  public async getClientVersion(): Promise<Bytes32> {
    return this.version;
  }

  public async getFork(): Promise<{fork: Fork; chainId: Uint64; genesisValidatorsRoot: Root}> {
    return {fork: this.fork, chainId: BigInt(1), genesisValidatorsRoot: ZERO_HASH};
  }

  public async getGenesis(): Promise<Genesis | null> {
    return {
      genesisTime: BigInt(this.genesisTime),
      genesisForkVersion: Buffer.alloc(8, 1),
      genesisValidatorsRoot: Buffer.alloc(32, 1),
    };
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
