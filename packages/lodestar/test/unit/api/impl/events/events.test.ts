import {EventsApi} from "../../../../../lib/api/impl/events";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../../../src/chain";
import {generateBlockSummary, generateSignedBlock} from "../../../../utils/block";
import {expect} from "chai";
import {BeaconEventType} from "../../../../../src/api/impl/events";
import {generateAttestation, generateEmptySignedVoluntaryExit} from "../../../../utils/attestation";
import {generateState} from "../../../../utils/state";

describe("Events api impl", function () {
  describe("beacon event stream", function () {
    let chainStub: SinonStubbedInstance<IBeaconChain>;
    let chainEventEmmitter: ChainEventEmitter;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
      chainEventEmmitter = new ChainEventEmitter();
      chainStub.emitter = chainEventEmmitter;
    });

    it("should process head event", async function () {
      const api = new EventsApi({}, {config, chain: chainStub});
      const stream = api.getEventStream();
      const headSummary = generateBlockSummary();
      chainEventEmmitter.emit("forkChoice:head", headSummary);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect(event.value.type).to.equal(BeaconEventType.HEAD);
      expect(event.value.message).to.not.be.null;
      stream.stop();
    });

    it("should process block event", async function () {
      const api = new EventsApi({}, {config, chain: chainStub});
      const stream = api.getEventStream();
      const block = generateSignedBlock();
      chainEventEmmitter.emit("block", block);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect(event.value.type).to.equal(BeaconEventType.BLOCK);
      expect(event.value.message).to.not.be.null;
      stream.stop();
    });

    it("should process attestation event", async function () {
      const api = new EventsApi({}, {config, chain: chainStub});
      const stream = api.getEventStream();
      const attestation = generateAttestation();
      chainEventEmmitter.emit("attestation", attestation);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect(event.value.type).to.equal(BeaconEventType.ATTESTATION);
      expect(event.value.message).to.equal(attestation);
      stream.stop();
    });

    it.skip("should process voluntary exit event", async function () {
      const api = new EventsApi({}, {config, chain: chainStub});
      const stream = api.getEventStream();
      const exit = generateEmptySignedVoluntaryExit();
      // chainEventEmmitter.emit("voluntaryExit", exit);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect(event.value.type).to.equal(BeaconEventType.VOLUNTARY_EXIT);
      expect(event.value.message).to.equal(exit);
      stream.stop();
    });

    it("should process finalized checkpoint event", async function () {
      const api = new EventsApi({}, {config, chain: chainStub});
      const stream = api.getEventStream();
      const checkpoint = generateState().finalizedCheckpoint;
      chainEventEmmitter.emit("forkChoice:finalized", checkpoint);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect(event.value.type).to.equal(BeaconEventType.FINALIZED_CHECKPOINT);
      expect(event.value.message).to.not.be.null;
      stream.stop();
    });

    it("should process chain reorg event", async function () {
      const api = new EventsApi({}, {config, chain: chainStub});
      const stream = api.getEventStream();
      const oldHead = generateBlockSummary({slot: 4});
      const newHead = generateBlockSummary({slot: 3});
      chainEventEmmitter.emit("forkChoice:reorg", oldHead, newHead);
      const event = await stream[Symbol.asyncIterator]().next();
      expect(event?.value).to.not.be.null;
      expect(event.value.type).to.equal(BeaconEventType.CHAIN_REORG);
      expect(event.value.message).to.not.be.null;
      expect(event.value.message.depth).to.equal(0);
      stream.stop();
    });
  });
});
