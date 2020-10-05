import sinon, {SinonSandbox, SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {ApiClientEventEmitter, IApiClient, RestBeaconApi, RestValidatorApi} from "../../src/api";
import {IBeaconApiClient, IEventsApi, INodeApi, IValidatorApi} from "../../src/api/types";
import {RestEventsApi} from "../../src/api/impl/rest/events/events";
import {RestNodeApi} from "../../src/api/impl/rest/node/node";
import {EventEmitter} from "events";
import {Root} from "@chainsafe/lodestar-types";

// @ts-ignore
export class SinonStubbedBeaconApi extends (EventEmitter as {new (): ApiClientEventEmitter})
  implements SinonStubbedInstance<IApiClient> {
  beacon: SinonStubbedInstance<IBeaconApiClient>;
  node: SinonStubbedInstance<INodeApi>;
  validator: SinonStubbedInstance<IValidatorApi>;
  events: SinonStubbedInstance<IEventsApi>;
  url!: string;
  genesisValidatorsRoot: Root = Buffer.alloc(32, 0);

  connect: SinonStubbedMember<IApiClient["connect"]> = sinon.stub();
  disconnect: SinonStubbedMember<IApiClient["disconnect"]> = sinon.stub();
  getCurrentSlot: SinonStubbedMember<IApiClient["getCurrentSlot"]> = sinon.stub();
  onNewEpoch: SinonStubbedMember<IApiClient["onNewEpoch"]> = sinon.stub();
  onNewSlot: SinonStubbedMember<IApiClient["onNewSlot"]> = sinon.stub();

  constructor(sandbox: SinonSandbox = sinon) {
    super();
    this.beacon = sandbox.createStubInstance(RestBeaconApi);
    this.node = sandbox.createStubInstance(RestNodeApi);
    this.validator = sandbox.createStubInstance(RestValidatorApi);
    this.events = sandbox.createStubInstance(RestEventsApi);
  }

}
