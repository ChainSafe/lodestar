import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {ApiNamespace} from "../../../src/api";
import {ILodestarApi} from "../../../src/api/impl/lodestar";

export class StubbedLodestarApi implements SinonStubbedInstance<ILodestarApi> {
  namespace: ApiNamespace.LODESTAR = ApiNamespace.LODESTAR;

  getWtfNode: Sinon.SinonStubbedMember<ILodestarApi["getWtfNode"]>;
  getLatestWeakSubjectivityCheckpointEpoch: Sinon.SinonStubbedMember<
    ILodestarApi["getLatestWeakSubjectivityCheckpointEpoch"]
  >;
  getSyncChainsDebugState: Sinon.SinonStubbedMember<ILodestarApi["getSyncChainsDebugState"]>;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.getWtfNode = sandbox.stub();
    this.getLatestWeakSubjectivityCheckpointEpoch = sandbox.stub();
    this.getSyncChainsDebugState = sandbox.stub();
  }
}
