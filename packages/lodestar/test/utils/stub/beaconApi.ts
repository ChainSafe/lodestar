import {IBeaconApi} from "../../../src/api/impl/beacon";
import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../src/api/impl/beacon/blocks";
import {BeaconPoolApi, IBeaconPoolApi} from "../../../src/api/impl/beacon/pool";
import {IBeaconStateApi} from "../../../src/api/impl/beacon/state/interface";
import {BeaconStateApi} from "../../../src/api/impl/beacon/state/state";

export class StubbedBeaconApi implements SinonStubbedInstance<IBeaconApi> {
  blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  state: SinonStubbedInstance<IBeaconStateApi>;
  pool: SinonStubbedInstance<IBeaconPoolApi>;
  getBlockStream: Sinon.SinonStubbedMember<IBeaconApi["getBlockStream"]>;
  getGenesis: Sinon.SinonStubbedMember<IBeaconApi["getGenesis"]>;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.state = sandbox.createStubInstance(BeaconStateApi);
    this.blocks = sandbox.createStubInstance(BeaconBlockApi);
    this.pool = sandbox.createStubInstance(BeaconPoolApi);
    this.getBlockStream = sandbox.stub();
    this.getGenesis = sandbox.stub();
  }
}
