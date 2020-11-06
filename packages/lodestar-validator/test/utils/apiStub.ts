import {EventEmitter} from "events";
import sinon, {SinonSandbox, SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {ApiClientEventEmitter, IApiClient, RestValidatorApi} from "../../src/api";
import {RestBeaconStateApi} from "../../src/api/impl/rest/beacon/state";
import {RestEventsApi} from "../../src/api/impl/rest/events/events";
import {RestNodeApi} from "../../src/api/impl/rest/node/node";
import {IBeaconApi, IBeaconStateApi} from "../../src/api/interface/beacon";
import {IEventsApi} from "../../src/api/interface/events";
import {INodeApi} from "../../src/api/interface/node";
import {IValidatorApi} from "../../src/api/interface/validators";
import {LocalClock} from "../../src/api/LocalClock";

class SinonStubbedBeaconApi implements IBeaconApi {
  public getGenesis: SinonStubbedMember<IBeaconApi["getGenesis"]>;
  public state: SinonStubbedInstance<IBeaconStateApi>;

  constructor(sandbox: SinonSandbox = sinon) {
    this.getGenesis = sandbox.stub();
    this.state = sandbox.createStubInstance(RestBeaconStateApi);
  }
}

export class SinonStubbedApi extends (EventEmitter as {new (): ApiClientEventEmitter}) implements IApiClient {
  beacon: SinonStubbedBeaconApi;
  node: SinonStubbedInstance<INodeApi>;
  validator: SinonStubbedInstance<IValidatorApi>;
  events: SinonStubbedInstance<IEventsApi>;
  clock: SinonStubbedInstance<LocalClock>;
  url!: string;
  genesisValidatorsRoot: import("@chainsafe/ssz").Vector<number>;

  connect: SinonStubbedMember<IApiClient["connect"]> = sinon.stub();
  disconnect: SinonStubbedMember<IApiClient["disconnect"]> = sinon.stub();

  constructor(sandbox: SinonSandbox = sinon) {
    super();
    this.beacon = new SinonStubbedBeaconApi(sandbox);
    this.beacon.state = sandbox.createStubInstance(RestBeaconStateApi);
    this.node = sandbox.createStubInstance(RestNodeApi);
    this.validator = sandbox.createStubInstance(RestValidatorApi);
    this.events = sandbox.createStubInstance(RestEventsApi);
    this.clock = sandbox.createStubInstance(LocalClock);
    this.genesisValidatorsRoot = Buffer.alloc(32, 0);
  }
}
