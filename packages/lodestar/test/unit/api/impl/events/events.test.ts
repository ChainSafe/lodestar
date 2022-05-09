import {AbortController} from "@chainsafe/abort-controller";
import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {routes} from "@chainsafe/lodestar-api";
import {config} from "@chainsafe/lodestar-config/default";
import {BeaconChain, ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../../../src/chain";
import {getEventsApi} from "../../../../../src/api/impl/events";
import {generateProtoBlock, generateEmptySignedBlock, generateSignedBlock} from "../../../../utils/block";
import {generateAttestation, generateEmptySignedVoluntaryExit} from "../../../../utils/attestation";
import {generateCachedState} from "../../../../utils/state";
import {StateContextCache} from "../../../../../src/chain/stateCache";

describe("Events api impl", function () {
  describe("beacon event stream", function () {
    let chainStub: SinonStubbedInstance<IBeaconChain>;
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
      api.eventstream(topics, controller.signal, (event) => {
        events.push(event);
      });
      return events;
    }

    it("should ignore not sent topics", async function () {
      const events = getEvents([routes.events.EventType.head]);

      const headBlock = generateProtoBlock();
      stateCacheStub.get.withArgs(headBlock.stateRoot).returns(generateCachedState({slot: 1000}));
      chainEventEmmitter.emit(ChainEvent.forkChoiceReorg, headBlock, headBlock, 2);
      chainEventEmmitter.emit(ChainEvent.forkChoiceHead, headBlock);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.head);
      expect(events[0].message).to.not.be.null;
    });

    it("should process head event", async function () {
      const events = getEvents([routes.events.EventType.head]);

      const headBlock = generateProtoBlock();
      stateCacheStub.get.withArgs(headBlock.stateRoot).returns(generateCachedState({slot: 1000}));
      chainEventEmmitter.emit(ChainEvent.forkChoiceHead, headBlock);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.head);
      expect(events[0].message).to.not.be.null;
    });

    it("should process block event", async function () {
      const events = getEvents([routes.events.EventType.block]);

      const block = generateSignedBlock();
      chainEventEmmitter.emit(ChainEvent.block, block, null as any);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.block);
      expect(events[0].message).to.not.be.null;
    });

    it("should process attestation event", async function () {
      const events = getEvents([routes.events.EventType.attestation]);

      const attestation = generateAttestation();
      chainEventEmmitter.emit(ChainEvent.attestation, attestation);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.attestation);
      expect(events[0].message).to.equal(attestation);
    });

    it("should process voluntary exit event", async function () {
      const events = getEvents([routes.events.EventType.voluntaryExit]);

      const exit = generateEmptySignedVoluntaryExit();
      const block = generateEmptySignedBlock();
      block.message.body.voluntaryExits.push(exit);
      chainEventEmmitter.emit(ChainEvent.block, block, null as any);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.voluntaryExit);
      expect(events[0].message).to.equal(exit);
    });

    it("should process finalized checkpoint event", async function () {
      const events = getEvents([routes.events.EventType.finalizedCheckpoint]);

      const state = generateCachedState();
      const checkpoint = state.finalizedCheckpoint;
      chainEventEmmitter.emit(ChainEvent.finalized, checkpoint, state);

      expect(events).to.have.length(1, "Wrong num of received events");
      expect(events[0].type).to.equal(routes.events.EventType.finalizedCheckpoint);
      expect(events[0].message).to.not.be.null;
    });

    it("should process chain reorg event", async function () {
      const events = getEvents([routes.events.EventType.chainReorg]);

      const depth = 3;
      const oldHead = generateProtoBlock({slot: 4});
      const newHead = generateProtoBlock({slot: 3});
      chainEventEmmitter.emit(ChainEvent.forkChoiceReorg, oldHead, newHead, depth);

      expect(events).to.have.length(1, "Wrong num of received events");
      const event = events[0];
      if (event.type !== routes.events.EventType.chainReorg) throw Error(`Wrong event type ${event.type}`);
      expect(events[0].type).to.equal(routes.events.EventType.chainReorg);
      expect(event.message).to.not.be.null;
      expect(event.message.depth).to.equal(depth, "Wrong depth");
    });
  });
});
