import sinon, {SinonSandbox, SinonStubbedInstance, SinonStubbedMember} from "sinon";

import {IApi, ValidatorApi} from "../../../src/api/impl";

import {StubbedNodeApi} from "./nodeApi";
import {StubbedBeaconApi} from "./beaconApi";
import {EventsApi} from "../../../src/api/impl/events";

export class StubbedApi implements SinonStubbedInstance<IApi> {
  beacon: StubbedBeaconApi;
  node: StubbedNodeApi;
  validator: SinonStubbedInstance<ValidatorApi>;
  events: SinonStubbedMember<IApi["events"]>;

  constructor(sandbox: SinonSandbox = sinon) {
    this.beacon = new StubbedBeaconApi(sandbox);
    this.node = new StubbedNodeApi(sandbox);
    this.validator = sandbox.createStubInstance(ValidatorApi);
    this.events = sandbox.createStubInstance(EventsApi);
  }
}
