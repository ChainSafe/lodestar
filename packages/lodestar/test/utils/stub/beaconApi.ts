import {IBeaconApi} from "../../../src/api/impl/beacon";
import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../src/api/impl/beacon/blocks";
import {ApiNamespace} from "../../../src/api";
import {BeaconPoolApi, IBeaconPoolApi} from "../../../src/api/impl/beacon/pool";
import {IBeaconStateApi} from "../../../lib/api/impl/beacon/state/interface";
import {BeaconStateApi} from "../../../lib/api/impl/beacon/state/state";

export class StubbedBeaconApi implements SinonStubbedInstance<IBeaconApi> {
  blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  state: SinonStubbedInstance<IBeaconStateApi>;
  pool: SinonStubbedInstance<IBeaconPoolApi>;
  getBlockStream: Sinon.SinonStubbedMember<IBeaconApi["getBlockStream"]>;
  getFork: Sinon.SinonStubbedMember<IBeaconApi["getFork"]>;
  getValidator: Sinon.SinonStubbedMember<IBeaconApi["getValidator"]>;
  getGenesis: Sinon.SinonStubbedMember<IBeaconApi["getGenesis"]>;
  namespace: ApiNamespace.BEACON;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.state = sandbox.createStubInstance(BeaconStateApi);
    this.blocks = sandbox.createStubInstance(BeaconBlockApi);
    this.pool = sandbox.createStubInstance(BeaconPoolApi);
    this.getBlockStream = sandbox.stub();
    this.getFork = sandbox.stub();
    this.getGenesis = sandbox.stub();
    this.getValidator = sandbox.stub();
  }

}
