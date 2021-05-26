import sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";

import {IApi, ValidatorApi} from "../../../src/api/impl";

import {StubbedNodeApi} from "./nodeApi";
import {StubbedBeaconApi} from "./beaconApi";
import {EventsApi} from "../../../src/api/impl/events";
import {DebugApi} from "../../../src/api/impl/debug";
import {DebugBeaconApi} from "../../../src/api/impl/debug/beacon";
import {ConfigApi} from "../../../src/api/impl/config";
import {LightclientApi} from "../../../src/api/impl/lightclient";
import {LodestarApi} from "../../../src/api/impl/lodestar";
import {StubbedConfigApi} from "./configApi";

export class StubbedApi implements SinonStubbedInstance<IApi> {
  beacon: StubbedBeaconApi;
  node: StubbedNodeApi;
  validator: SinonStubbedInstance<ValidatorApi>;
  events: SinonStubbedInstance<EventsApi>;
  debug: SinonStubbedInstance<DebugApi>;
  config: SinonStubbedInstance<ConfigApi>;
  lightclient: SinonStubbedInstance<LightclientApi>;
  lodestar: SinonStubbedInstance<LodestarApi>;

  constructor(sandbox: SinonSandbox = sinon) {
    this.beacon = new StubbedBeaconApi(sandbox);
    this.node = new StubbedNodeApi(sandbox);
    this.validator = sandbox.createStubInstance(ValidatorApi);
    this.events = sandbox.createStubInstance(EventsApi);
    const debugBeacon = sandbox.createStubInstance(DebugBeaconApi);
    this.debug = sandbox.createStubInstance(DebugApi);
    this.debug.beacon = debugBeacon;
    this.config = new StubbedConfigApi(sandbox);
    this.lightclient = sandbox.createStubInstance(LightclientApi);
    this.lodestar = sandbox.createStubInstance(LodestarApi);
  }
}
