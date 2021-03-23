import {Bytes32, phase0, Number64} from "@chainsafe/lodestar-types";
import {generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";
import sinon, {SinonStubbedInstance} from "sinon";
import {IBeaconBlocksApi} from "../../../src/api/interface/beacon";
import {RestBeaconBlocksApi} from "../../../src/api/impl/rest/beacon/blocks";
import {RestBeaconPoolApi} from "../../../src/api/impl/rest/beacon/pool";
import {RestBeaconStateApi} from "../../../src/api/impl/rest/beacon/state";
import {IBeaconApi, IBeaconPoolApi, IBeaconStateApi} from "../../../src/api/interface/beacon";

export interface IMockBeaconApiOpts {
  version?: Bytes32;
  fork?: phase0.Fork;
  head?: phase0.BeaconBlock;
  genesisTime?: Number64;
}

export class MockBeaconApi implements IBeaconApi {
  state: SinonStubbedInstance<IBeaconStateApi>;
  blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  pool: SinonStubbedInstance<IBeaconPoolApi>;

  private version: Bytes32;
  private fork: phase0.Fork;
  private head: phase0.BeaconBlock;
  private genesisTime: Number64;

  constructor(opts?: IMockBeaconApiOpts) {
    this.version = (opts && opts.version) || Buffer.alloc(0);
    this.fork = (opts && opts.fork) || {previousVersion: Buffer.alloc(0), currentVersion: Buffer.alloc(0), epoch: 0};
    this.head = (opts && opts.head) || generateEmptyBlock();
    this.genesisTime = (opts && opts.genesisTime) || Math.floor(Date.now() / 1000);
    this.state = sinon.createStubInstance(RestBeaconStateApi);
    this.blocks = sinon.createStubInstance(RestBeaconBlocksApi);
    this.pool = sinon.createStubInstance(RestBeaconPoolApi);
  }

  async getValidator(): Promise<any> {
    throw new Error("Method not implemented.");
  }

  async getGenesis(): Promise<phase0.Genesis | null> {
    return {
      genesisTime: BigInt(this.genesisTime),
      genesisForkVersion: Buffer.alloc(8, 1),
      genesisValidatorsRoot: Buffer.alloc(32, 1),
    };
  }
}
