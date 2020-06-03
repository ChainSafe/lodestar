import {describe, it} from "mocha";
import {
  getAttestationSubnetEvent,
  getAttestationSubnetTopic,
  getGossipTopic,
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  mapGossipEvent,
  topicToGossipEvent
} from "../../../../src/network/gossip/utils";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {expect} from "chai";
import {ATTESTATION_SUBNET_COUNT} from "../../../../src/constants";
import {GossipEncoding} from "../../../../src/network/gossip/encoding";

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
        new Map([["param1", "test"], ["param2", "test2"]])
      );
      expect(topic).to.be.equal("/eth2/00000000/test/test2/ssz");
    });

    it("get attestation subnet topic", function () {
      const subnet = 10;
      const topic = getAttestationSubnetTopic(subnet, forkValue);
      expect(topic).to.be.equal("/eth2/00000000/committee_index10_beacon_attestation/ssz_snappy");
    });

  });

  describe("isAttestationSubnetTopic", () => {
    it("should return valid attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkValue,
          GossipEncoding.SSZ,
          new Map([["subnet", subnet.toString()]]),
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
      expect(mapGossipEvent(GossipEvent.ATTESTATION)).to.be.equal(GossipEvent.ATTESTATION);
      expect(mapGossipEvent(GossipEvent.AGGREGATE_AND_PROOF)).to.be.equal(GossipEvent.AGGREGATE_AND_PROOF);
      expect(mapGossipEvent(GossipEvent.VOLUNTARY_EXIT)).to.be.equal(GossipEvent.VOLUNTARY_EXIT);
      expect(mapGossipEvent(GossipEvent.PROPOSER_SLASHING)).to.be.equal(GossipEvent.PROPOSER_SLASHING);
      expect(mapGossipEvent(GossipEvent.ATTESTER_SLASHING)).to.be.equal(GossipEvent.ATTESTER_SLASHING);
    });
  });

  describe("topicToGossipEvent", () => {
    it("should get correct GossipEvent from topic", () => {
      expect(topicToGossipEvent(getGossipTopic(GossipEvent.BLOCK, forkValue))).to.be.equal(GossipEvent.BLOCK);
      expect(
        topicToGossipEvent(getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, forkValue))
      ).to.be.equal(GossipEvent.AGGREGATE_AND_PROOF);
      expect(
        topicToGossipEvent(getGossipTopic(GossipEvent.ATTESTATION, forkValue))
      ).to.be.equal(GossipEvent.ATTESTATION);
      expect(
        topicToGossipEvent(getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkValue))
      ).to.be.equal(GossipEvent.VOLUNTARY_EXIT);
      expect(
        topicToGossipEvent(getGossipTopic(GossipEvent.PROPOSER_SLASHING, forkValue))
      ).to.be.equal(GossipEvent.PROPOSER_SLASHING);
      expect(
        topicToGossipEvent(getGossipTopic(GossipEvent.ATTESTER_SLASHING, forkValue))
      ).to.be.equal(GossipEvent.ATTESTER_SLASHING);
    });
  });

  describe("getSubnetFromAttestationSubnetTopic", () => {
    it("should get correct subnet from attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkValue,
          GossipEncoding.SSZ,
          new Map([["subnet", subnet.toString()]]),
        );
        expect(getSubnetFromAttestationSubnetTopic(topic)).to.be.equal(subnet);
      }
    });
  });

});
