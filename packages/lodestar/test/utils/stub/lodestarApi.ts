import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {ILodestarApi} from "../../../src/api/impl/lodestar";

export class StubbedLodestarApi implements SinonStubbedInstance<ILodestarApi> {
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
