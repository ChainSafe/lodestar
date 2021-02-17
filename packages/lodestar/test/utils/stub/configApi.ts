import Sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {ApiNamespace} from "../../../src/api";
import {IConfigApi} from "../../../src/api/impl/config";

export class StubbedConfigApi implements SinonStubbedInstance<IConfigApi> {
  namespace: ApiNamespace.CONFIG = ApiNamespace.CONFIG;

  getDepositContract: Sinon.SinonStubbedMember<IConfigApi["getDepositContract"]>;
  getForkSchedule: Sinon.SinonStubbedMember<IConfigApi["getForkSchedule"]>;
  getSpec: Sinon.SinonStubbedMember<IConfigApi["getSpec"]>;

  constructor(sandbox: SinonSandbox = Sinon) {
    this.getDepositContract = sandbox.stub();
    this.getForkSchedule = sandbox.stub();
    this.getSpec = sandbox.stub();
  }
}
