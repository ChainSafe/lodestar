import sinon, {SinonSandbox, SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {
  ApiClientEventEmitter,
  IApiClient,
  INewEpochCallback,
  INewSlotCallback,
  RestBeaconApi,
  RestValidatorApi,
} from "../../src/api";
import {IBeaconApi} from "../../src/api/interface/beacon";
import {INodeApi} from "../../src/api/interface/node";
import {IValidatorApi} from "../../src/api/interface/validators";
import {IEventsApi} from "../../src/api/interface/events";
import {RestEventsApi} from "../../src/api/impl/rest/events/events";
import {RestNodeApi} from "../../src/api/impl/rest/node/node";
import {EventEmitter} from "events";

// @ts-ignore
export class SinonStubbedBeaconApi extends (EventEmitter as {new (): ApiClientEventEmitter})
  implements SinonStubbedInstance<IApiClient> {
  beacon: SinonStubbedInstance<IBeaconApi>;
  node: SinonStubbedInstance<INodeApi>;
  validator: SinonStubbedInstance<IValidatorApi>;
  events: SinonStubbedInstance<IEventsApi>;
  url!: string;

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
