import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {BeaconChain, ChainEventEmitter, HeadEventData} from "../../../../../src/chain/index.js";
import {getEventsApi} from "../../../../../src/api/impl/events/index.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {generateCachedState} from "../../../../utils/state.js";
import {StateContextCache} from "../../../../../src/chain/stateCache/index.js";
import {StubbedChainMutable} from "../../../../utils/stub/index.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/constants.js";

describe("Events api impl", function () {
  describe("beacon event stream", function () {
    let chainStub: StubbedChainMutable<"stateCache" | "emitter">;
    let stateCacheStub: SinonStubbedInstance<StateContextCache>;
    let chainEventEmmitter: ChainEventEmitter;
    let api: ReturnType<typeof getEventsApi>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
      stateCacheStub = sinon.createStubInstance(StateContextCache);
      chainStub.stateCache = (stateCacheStub as unknown) as StateContextCache;
      chainEventEmmitter = new ChainEventEmitter();
      chainStub.emitter = chainEventEmmitter;
      api = getEventsApi({config, chain: chainStub});
    });

    let controller: AbortController;
    beforeEach(() => (controller = new AbortController()));
    afterEach(() => controller.abort());

    function getEvents(topics: routes.events.EventType[]): routes.events.BeaconEvent[] {
      const events: routes.events.BeaconEvent[] = [];
      void api.eventstream(topics, controller.signal, (event) => {
        events.push(event);
      });
      return events;
    }

    const headEventData: HeadEventData = {
      slot: 0,
      block: ZERO_HASH_HEX,
      state: ZERO_HASH_HEX,
      epochTransition: false,
      previousDutyDependentRoot: ZERO_HASH_HEX,
      currentDutyDependentRoot: ZERO_HASH_HEX,
      executionOptimistic: false,
    };

    it("should ignore not sent topics", async function () {
      const events = getEvents([routes.events.EventType.head]);

      const headBlock = generateProtoBlock();
      stateCacheStub.get.withArgs(headBlock.stateRoot).returns(generateCachedState({slot: 1000}));
      chainEventEmmitter.emit(routes.events.EventType.attestation, ssz.phase0.Attestation.defaultValue());
      chainEventEmmitter.emit(routes.events.EventType.head, headEventData);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.head);
      expect(events[0].message).to.not.be.null;
    });
  });
});
