import {EventEmitter} from "events";
import sinon, {SinonSandbox, SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ApiClientEventEmitter, IApiClient, IApiClientProvider} from "../../src/api";
import {LocalClock} from "../../src/api/LocalClock";
import {ApiClientOverRest} from "../../src/api/rest";

export class SinonStubbedApi extends (EventEmitter as {new (): ApiClientEventEmitter}) implements IApiClient {
  beacon: {
    getGenesis: SinonStubbedInstance<IApiClient["beacon"]>["getGenesis"];
    state: SinonStubbedInstance<IApiClient["beacon"]["state"]>;
    blocks: SinonStubbedInstance<IApiClient["beacon"]["blocks"]>;
    pool: SinonStubbedInstance<IApiClient["beacon"]["pool"]>;
  };
  node: SinonStubbedInstance<IApiClient["node"]>;
  validator: SinonStubbedInstance<IApiClient["validator"]>;
  events: SinonStubbedInstance<IApiClient["events"]>;
  config: SinonStubbedInstance<IApiClient["config"]>;
  clock: SinonStubbedInstance<LocalClock>;
  url!: string;
  genesisValidatorsRoot: import("@chainsafe/ssz").Vector<number>;

  connect: SinonStubbedMember<IApiClientProvider["connect"]> = sinon.stub();
  disconnect: SinonStubbedMember<IApiClientProvider["disconnect"]> = sinon.stub();

  constructor(sandbox: SinonSandbox = sinon) {
    super();
    const api = ApiClientOverRest(config, "");
    this.beacon = {
      ...sandbox.stub(api.beacon),
      state: sandbox.stub(api.beacon.state),
      blocks: sandbox.stub(api.beacon.blocks),
      pool: sandbox.stub(api.beacon.pool),
    };
    this.node = sandbox.stub(api.node);
    this.validator = sandbox.stub(api.validator);
    this.events = sandbox.stub(api.events);
    this.config = sandbox.stub(api.config);

    this.clock = sandbox.createStubInstance(LocalClock);
    this.genesisValidatorsRoot = Buffer.alloc(32, 0);
  }
}
