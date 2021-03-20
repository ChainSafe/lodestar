import {
  BeaconAttestationEvent,
  BeaconBlockEvent,
  BeaconChainReorgEvent,
  BeaconEventType,
  BeaconHeadEvent,
  EventsApi,
  FinalizedCheckpointEvent,
  VoluntaryExitEvent,
} from "../../../../../src/api/impl/events";
import {config} from "@chainsafe/lodestar-config/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../../../src/chain";
import {generateBlockSummary, generateEmptySignedBlock, generateSignedBlock} from "../../../../utils/block";
import {expect} from "chai";
import {generateAttestation, generateEmptySignedVoluntaryExit} from "../../../../utils/attestation";
import {generateState} from "../../../../utils/state";

describe("Events api impl", function () {
  describe("beacon event stream", function () {
    let chainStub: SinonStubbedInstance<IBeaconChain>;
    let chainEventEmmitter: ChainEventEmitter;
    let api: EventsApi;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
      chainEventEmmitter = new ChainEventEmitter();
      chainStub.emitter = chainEventEmmitter;
      api = new EventsApi({}, {config, chain: chainStub});
    });

    it("should ignore not sent topics", async function () {
      const stream = api.getEventStream([BeaconEventType.HEAD]);
      const headSummary = generateBlockSummary();
      chainEventEmmitter.emit(ChainEvent.forkChoiceReorg, headSummary, headSummary, 2);
      chainEventEmmitter.emit(ChainEvent.forkChoiceHead, headSummary);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as BeaconHeadEvent).type).to.equal(BeaconEventType.HEAD);
      expect((event.value as BeaconHeadEvent).message).to.not.be.null;
      stream.stop();
    });

    it("should process head event", async function () {
      const stream = api.getEventStream([BeaconEventType.HEAD]);
      const headSummary = generateBlockSummary();
      chainEventEmmitter.emit(ChainEvent.forkChoiceHead, headSummary);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as BeaconHeadEvent).type).to.equal(BeaconEventType.HEAD);
      expect((event.value as BeaconHeadEvent).message).to.not.be.null;
      stream.stop();
    });

    it("should process block event", async function () {
      const stream = api.getEventStream([BeaconEventType.BLOCK]);
      const block = generateSignedBlock();
      chainEventEmmitter.emit(ChainEvent.block, block, null as any, null as any);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as BeaconBlockEvent).type).to.equal(BeaconEventType.BLOCK);
      expect((event.value as BeaconBlockEvent).message).to.not.be.null;
      stream.stop();
    });

    it("should process attestation event", async function () {
      const stream = api.getEventStream([BeaconEventType.ATTESTATION]);
      const attestation = generateAttestation();
      chainEventEmmitter.emit(ChainEvent.attestation, attestation);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as BeaconAttestationEvent).type).to.equal(BeaconEventType.ATTESTATION);
      expect((event.value as BeaconAttestationEvent).message).to.equal(attestation);
      stream.stop();
    });

    it("should process voluntary exit event", async function () {
      const stream = api.getEventStream([BeaconEventType.VOLUNTARY_EXIT]);
      const exit = generateEmptySignedVoluntaryExit();
      const block = generateEmptySignedBlock();
      block.message.body.voluntaryExits.push(exit);
      chainEventEmmitter.emit(ChainEvent.block, block, null as any, null as any);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as VoluntaryExitEvent).type).to.equal(BeaconEventType.VOLUNTARY_EXIT);
      expect((event.value as VoluntaryExitEvent).message).to.equal(exit);
      stream.stop();
    });

    it("should process finalized checkpoint event", async function () {
      const stream = api.getEventStream([BeaconEventType.FINALIZED_CHECKPOINT]);
      const checkpoint = generateState().finalizedCheckpoint;
      chainEventEmmitter.emit(ChainEvent.finalized, checkpoint, null as any);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as FinalizedCheckpointEvent).type).to.equal(BeaconEventType.FINALIZED_CHECKPOINT);
      expect((event.value as FinalizedCheckpointEvent).message).to.not.be.null;
      stream.stop();
    });

    it("should process chain reorg event", async function () {
      const stream = api.getEventStream([BeaconEventType.CHAIN_REORG]);
      const oldHead = generateBlockSummary({slot: 4});
      const newHead = generateBlockSummary({slot: 3});
      chainEventEmmitter.emit(ChainEvent.forkChoiceReorg, oldHead, newHead, 3);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect((event.value as BeaconChainReorgEvent).type).to.equal(BeaconEventType.CHAIN_REORG);
      expect((event.value as BeaconChainReorgEvent).message).to.not.be.null;
      expect((event.value as BeaconChainReorgEvent).message.depth).to.equal(3);
      stream.stop();
    });
  });
});
