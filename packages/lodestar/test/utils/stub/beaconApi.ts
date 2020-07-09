import {IBeaconApi} from "../../../src/api/impl/beacon";
import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../src/api/impl/beacon/blocks";
import {ApiNamespace} from "../../../src/api";

export class StubbedBeaconApi implements SinonStubbedInstance<IBeaconApi> {
  blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  getBlockStream: Sinon.SinonStubbedMember<IBeaconApi["getBlockStream"]>;
  getClientVersion: Sinon.SinonStubbedMember<IBeaconApi["getClientVersion"]>;
  getFork: Sinon.SinonStubbedMember<IBeaconApi["getFork"]>;
  getGenesisTime: Sinon.SinonStubbedMember<IBeaconApi["getGenesisTime"]>;
  getSyncingStatus: Sinon.SinonStubbedMember<IBeaconApi["getSyncingStatus"]>;
  getValidator: Sinon.SinonStubbedMember<IBeaconApi["getValidator"]>;
  getHead: Sinon.SinonStubbedMember<IBeaconApi["getHead"]>;
  getPeers: Sinon.SinonStubbedMember<IBeaconApi["getPeers"]>;

  namespace: ApiNamespace.BEACON;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.blocks = sandbox.createStubInstance(BeaconBlockApi);
    this.getBlockStream = sandbox.stub();
    this.getClientVersion = sandbox.stub();
    this.getFork = sandbox.stub();
    this.getGenesisTime = sandbox.stub();
    this.getSyncingStatus = sandbox.stub();
    this.getValidator = sandbox.stub();
    this.getHead = sandbox.stub();
  }

}
