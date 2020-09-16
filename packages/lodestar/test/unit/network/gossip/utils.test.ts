import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {
  getAttestationSubnetEvent,
  getBlockStateContext,
  getGossipTopic,
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  mapGossipEvent,
  topicToGossipEvent,
} from "../../../../src/network/gossip/utils";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {ATTESTATION_SUBNET_COUNT} from "../../../../src/constants";
import {GossipEncoding} from "../../../../src/network/gossip/encoding";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateBlockSummary, generateSignedBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";

const forkValue = Buffer.alloc(4);
describe("gossip utils", function () {
  describe("getGossipTopic", function () {
    it("should get gossip topic with default encoding", function () {
      const topic = getGossipTopic(GossipEvent.BLOCK, forkValue);
      expect(topic).to.be.equal("/eth2/00000000/beacon_block/ssz_snappy");
    });

    it("should get gossip topic with different encoding", function () {
      const topic = getGossipTopic(GossipEvent.BLOCK, forkValue, GossipEncoding.SSZ);
      expect(topic).to.be.equal("/eth2/00000000/beacon_block/ssz");
    });

    it("should get gossip topic with params", function () {
      const topic = getGossipTopic(
        "{param1}/{param2}" as GossipEvent,
        forkValue,
        GossipEncoding.SSZ,
        new Map([
          ["param1", "test"],
          ["param2", "test2"],
        ])
      );
      expect(topic).to.be.equal("/eth2/00000000/test/test2/ssz");
    });

    it("get attestation subnet topic", function () {
      const subnet = 10;
      const topic = getGossipTopic(
        GossipEvent.ATTESTATION_SUBNET,
        forkValue,
        GossipEncoding.SSZ_SNAPPY,
        new Map([["subnet", String(subnet)]])
      );
      expect(topic).to.be.equal("/eth2/00000000/beacon_attestation_10/ssz_snappy");
    });
  });

  describe("isAttestationSubnetTopic", () => {
    it("should return valid attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkValue,
          GossipEncoding.SSZ,
          new Map([["subnet", subnet.toString()]])
        );
        expect(isAttestationSubnetTopic(topic)).to.be.equal(true);
      }
    });

    it("should return invalid attestation topic", () => {
      expect(isAttestationSubnetTopic("/eth2/beacon_block")).to.be.equal(false);
      expect(isAttestationSubnetTopic("/eth2/committee_indexx_beacon_attestation")).to.be.equal(false);
    });
  });

  describe("mapGossipEvent", () => {
    it("should get correct GossipEvents from IGossipEvent", () => {
      expect(mapGossipEvent(getAttestationSubnetEvent(0))).to.be.equal(GossipEvent.ATTESTATION_SUBNET);
      expect(mapGossipEvent(getAttestationSubnetEvent(1))).to.be.equal(GossipEvent.ATTESTATION_SUBNET);
      expect(mapGossipEvent(GossipEvent.BLOCK)).to.be.equal(GossipEvent.BLOCK);
      expect(mapGossipEvent(GossipEvent.AGGREGATE_AND_PROOF)).to.be.equal(GossipEvent.AGGREGATE_AND_PROOF);
      expect(mapGossipEvent(GossipEvent.VOLUNTARY_EXIT)).to.be.equal(GossipEvent.VOLUNTARY_EXIT);
      expect(mapGossipEvent(GossipEvent.PROPOSER_SLASHING)).to.be.equal(GossipEvent.PROPOSER_SLASHING);
      expect(mapGossipEvent(GossipEvent.ATTESTER_SLASHING)).to.be.equal(GossipEvent.ATTESTER_SLASHING);
    });
  });

  describe("topicToGossipEvent", () => {
    it("should get correct GossipEvent from topic", () => {
      expect(topicToGossipEvent(getGossipTopic(GossipEvent.BLOCK, forkValue))).to.be.equal(GossipEvent.BLOCK);
      expect(topicToGossipEvent(getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, forkValue))).to.be.equal(
        GossipEvent.AGGREGATE_AND_PROOF
      );
      expect(topicToGossipEvent(getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkValue))).to.be.equal(
        GossipEvent.VOLUNTARY_EXIT
      );
      expect(topicToGossipEvent(getGossipTopic(GossipEvent.PROPOSER_SLASHING, forkValue))).to.be.equal(
        GossipEvent.PROPOSER_SLASHING
      );
      expect(topicToGossipEvent(getGossipTopic(GossipEvent.ATTESTER_SLASHING, forkValue))).to.be.equal(
        GossipEvent.ATTESTER_SLASHING
      );
    });
  });

  describe("getSubnetFromAttestationSubnetTopic", () => {
    it("should get correct subnet from attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkValue,
          GossipEncoding.SSZ,
          new Map([["subnet", subnet.toString()]])
        );
        expect(getSubnetFromAttestationSubnetTopic(topic)).to.be.equal(subnet);
      }
    });
  });

  describe("get block state context", function () {
    let forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice;
    let dbStub: StubbedBeaconDb;

    beforeEach(function () {
      forkChoiceStub = sinon.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
      dbStub = new StubbedBeaconDb(sinon, config);
    });

    it("missing parent summary", async function () {
      const block = generateSignedBlock();
      forkChoiceStub.getBlock.returns(null);
      const stateContext = await getBlockStateContext(forkChoiceStub, dbStub, block.message.parentRoot);
      expect(stateContext).to.be.null;
      expect(forkChoiceStub.getBlock.withArgs(block.message.parentRoot.valueOf() as Uint8Array).calledOnce).to.be.true;
      expect(dbStub.stateCache.get.calledOnce).to.be.false;
    });

    it("missing state", async function () {
      const block = generateSignedBlock();
      const stateRoot = Buffer.alloc(32, 3);
      forkChoiceStub.getBlock.returns(generateBlockSummary({stateRoot}));
      dbStub.stateCache.get.resolves(null);
      const stateContext = await getBlockStateContext(forkChoiceStub, dbStub, block.message.parentRoot);
      expect(stateContext).to.be.null;
      expect(forkChoiceStub.getBlock.withArgs(block.message.parentRoot.valueOf() as Uint8Array).calledOnce).to.be.true;
      expect(dbStub.stateCache.get.withArgs(stateRoot).calledOnce).to.be.true;
    });

    it("found state", async function () {
      const block = generateSignedBlock();
      const stateRoot = Buffer.alloc(32, 3);
      forkChoiceStub.getBlock.returns(generateBlockSummary({stateRoot}));
      dbStub.stateCache.get.resolves({
        state: generateState(),
        epochCtx: new EpochContext(config),
      });
      const stateContext = await getBlockStateContext(forkChoiceStub, dbStub, block.message.parentRoot, 5);
      if (stateContext === null) throw Error("stateContext is null");
      expect(stateContext.state.slot).to.be.equal(5);
      expect(forkChoiceStub.getBlock.withArgs(block.message.parentRoot.valueOf() as Uint8Array).calledOnce).to.be.true;
      expect(dbStub.stateCache.get.withArgs(stateRoot).calledOnce).to.be.true;
    });
  });
});
