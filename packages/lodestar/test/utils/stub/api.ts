import sinon, {SinonSandbox, SinonStubbedInstance} from "sinon"; 

import {IApi, ValidatorApi} from "../../../src/api/impl";

import {StubbedNodeApi} from "./nodeApi";
import {StubbedBeaconApi} from "./beaconApi";

export class StubbedApi implements SinonStubbedInstance<IApi> {
  beacon: StubbedBeaconApi;
  node: StubbedNodeApi;
  validator: SinonStubbedInstance<ValidatorApi>;

  constructor(sandbox: SinonSandbox = sinon) {
    this.beacon = new StubbedBeaconApi(sandbox);
    this.node = new StubbedNodeApi(sandbox);
    this.validator = sandbox.createStubInstance(ValidatorApi);
  }
}
