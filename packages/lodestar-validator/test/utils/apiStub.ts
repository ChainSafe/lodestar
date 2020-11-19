import {EventEmitter} from "events";
import sinon, {SinonSandbox, SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {IBeaconBlocksApi} from "../../lib/api/interface/beacon";
import {ApiClientEventEmitter, IApiClient, RestValidatorApi} from "../../src/api";
import {RestBeaconBlocksApi} from "../../src/api/impl/rest/beacon/blocks";
import {RestBeaconStateApi} from "../../src/api/impl/rest/beacon/state";
import {RestEventsApi} from "../../src/api/impl/rest/events/events";
import {RestNodeApi} from "../../src/api/impl/rest/node/node";
import {IBeaconApi, IBeaconStateApi, IBeaconPoolApi} from "../../src/api/interface/beacon";
import {IEventsApi} from "../../src/api/interface/events";
import {INodeApi} from "../../src/api/interface/node";
import {IValidatorApi} from "../../src/api/interface/validators";
import {LocalClock} from "../../src/api/LocalClock";
import {RestBeaconPoolApi} from "../../src/api/impl/rest/beacon/pool";

class SinonStubbedBeaconApi implements IBeaconApi {
  public getValidator: SinonStubbedMember<IBeaconApi["getValidator"]>;
  public getGenesis: SinonStubbedMember<IBeaconApi["getGenesis"]>;
  public state: SinonStubbedInstance<IBeaconStateApi>;
  public blocks: SinonStubbedInstance<IBeaconBlocksApi>;
  public pool: SinonStubbedInstance<IBeaconPoolApi>;

  constructor(sandbox: SinonSandbox = sinon) {
    this.getValidator = sandbox.stub();
    this.getGenesis = sandbox.stub();
    this.state = sandbox.createStubInstance(RestBeaconStateApi);
    this.blocks = sandbox.createStubInstance(RestBeaconBlocksApi);
    this.pool = sandbox.createStubInstance(RestBeaconPoolApi);
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
