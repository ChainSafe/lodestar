import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {ApiNamespace} from "../../../src/api";
import {INodeApi} from "../../../src/api/impl/node";

export class StubbedNodeApi implements SinonStubbedInstance<INodeApi> {


  namespace: ApiNamespace.NODE;

  getNodeIdentity: Sinon.SinonStubbedMember<INodeApi["getNodeIdentity"]>;
  getNodeStatus: Sinon.SinonStubbedMember<INodeApi["getNodeStatus"]>;
  getPeer: Sinon.SinonStubbedMember<INodeApi["getPeer"]>;
  getPeers: Sinon.SinonStubbedMember<INodeApi["getPeers"]>;
  getSyncingStatus: Sinon.SinonStubbedMember<INodeApi["getSyncingStatus"]>;
  getVersion: Sinon.SinonStubbedMember<INodeApi["getVersion"]>;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.getNodeIdentity = sandbox.stub();
    this.getNodeStatus = sandbox.stub();
    this.getPeer = sandbox.stub();
    this.getPeers = sandbox.stub();
    this.getSyncingStatus = sandbox.stub();
    this.getVersion = sandbox.stub();
  }


}
