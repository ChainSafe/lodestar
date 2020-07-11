import {IBeaconApi} from "../../../src/api/impl/beacon";
import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../src/api/impl/beacon/blocks";
import {ApiNamespace} from "../../../src/api";

export class StubbedBeaconApi implements SinonStubbedInstance<IBeaconApi> {
  blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  getBlockStream: Sinon.SinonStubbedMember<IBeaconApi["getBlockStream"]>;
  getFork: Sinon.SinonStubbedMember<IBeaconApi["getFork"]>;
  getGenesisTime: Sinon.SinonStubbedMember<IBeaconApi["getGenesisTime"]>;
  getValidator: Sinon.SinonStubbedMember<IBeaconApi["getValidator"]>;
  namespace: ApiNamespace.BEACON;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.blocks = sandbox.createStubInstance(BeaconBlockApi);
    this.getBlockStream = sandbox.stub();
    this.getFork = sandbox.stub();
    this.getGenesisTime = sandbox.stub();
    this.getValidator = sandbox.stub();
  }

}
