import {IBeaconApi} from "../../../src/api/impl/beacon";
import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../src/api/impl/beacon/blocks";
import {ApiNamespace} from "../../../src/api";
import {BeaconPoolApi, IBeaconPoolApi} from "../../../src/api/impl/beacon/pool";

export class StubbedBeaconApi implements SinonStubbedInstance<IBeaconApi> {
  blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  pool: SinonStubbedInstance<IBeaconPoolApi>;
  getBlockStream: Sinon.SinonStubbedMember<IBeaconApi["getBlockStream"]>;
  getFork: Sinon.SinonStubbedMember<IBeaconApi["getFork"]>;
  getValidator: Sinon.SinonStubbedMember<IBeaconApi["getValidator"]>;
  getGenesis: Sinon.SinonStubbedMember<IBeaconApi["getGenesis"]>;
  namespace: ApiNamespace.BEACON;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.blocks = sandbox.createStubInstance(BeaconBlockApi);
    this.pool = sandbox.createStubInstance(BeaconPoolApi);
    this.getBlockStream = sandbox.stub();
    this.getFork = sandbox.stub();
    this.getGenesis = sandbox.stub();
    this.getValidator = sandbox.stub();
  }

}
