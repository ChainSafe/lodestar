import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {IConfigApi} from "../../../src/api/impl/config";

export class StubbedConfigApi implements SinonStubbedInstance<IConfigApi> {
  getDepositContract: Sinon.SinonStubbedMember<IConfigApi["getDepositContract"]>;
  getForkSchedule: Sinon.SinonStubbedMember<IConfigApi["getForkSchedule"]>;
  getSpec: Sinon.SinonStubbedMember<IConfigApi["getSpec"]>;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.getDepositContract = sandbox.stub();
    this.getForkSchedule = sandbox.stub();
    this.getSpec = sandbox.stub();
  }
}
