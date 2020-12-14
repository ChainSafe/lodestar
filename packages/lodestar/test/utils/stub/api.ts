import sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";

import {IApi, ValidatorApi} from "../../../src/api/impl";

import {StubbedNodeApi} from "./nodeApi";
import {StubbedBeaconApi} from "./beaconApi";
import {EventsApi} from "../../../src/api/impl/events";
import {DebugApi} from "../../../src/api/impl/debug";
import {DebugBeaconApi} from "../../../src/api/impl/debug/beacon";

export class StubbedApi implements SinonStubbedInstance<IApi> {
  beacon: StubbedBeaconApi;
  node: StubbedNodeApi;
  validator: SinonStubbedInstance<ValidatorApi>;
  events: SinonStubbedInstance<EventsApi>;
  debug: SinonStubbedInstance<DebugApi>;

  constructor(sandbox: SinonSandbox = sinon) {
    this.beacon = new StubbedBeaconApi(sandbox);
    this.node = new StubbedNodeApi(sandbox);
    this.validator = sandbox.createStubInstance(ValidatorApi);
    this.events = sandbox.createStubInstance(EventsApi);
    const debugBeacon = sandbox.createStubInstance(DebugBeaconApi);
    this.debug = {beacon: debugBeacon} as SinonStubbedInstance<DebugApi>;
  }
}
