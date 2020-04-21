import {describe, it} from "mocha";
import {
  getAttestationSubnetTopic,
  getGossipTopic,
  getSubnetFromAttestationSubnetTopic,
  isAttestationSubnetTopic,
  getGossipEvent
} from "../../../../src/network/gossip/utils";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {expect} from "chai";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {ATTESTATION_SUBNET_COUNT} from "../../../../src/constants";

const forkValue = Buffer.alloc(4);
describe("gossip utils", function () {
   
  describe("getGossipTopic", function () {
      
    it("should get gossip topic with default encoding", function () {
      const topic = getGossipTopic(GossipEvent.BLOCK, forkValue);
      expect(topic).to.be.equal("/eth2/00000000/beacon_block/ssz");
    });

    it("should get gossip topic with different encoding", function () {
      const topic = getGossipTopic(GossipEvent.BLOCK, forkValue, "ssz_snappy");
      expect(topic).to.be.equal("/eth2/00000000/beacon_block/ssz_snappy");
    });

    it("should get gossip topic with params", function () {
      const topic = getGossipTopic(
        "{param1}/{param2}" as GossipEvent,
        forkValue,
        "ssz",
        new Map([["param1", "test"], ["param2", "test2"]])
      );
      expect(topic).to.be.equal("/eth2/00000000/test/test2/ssz");
    });

    it("get attestation subnet topic", function () {
      const topic = getAttestationSubnetTopic(generateEmptyAttestation(), forkValue);
      expect(topic).to.be.equal("/eth2/00000000/committee_index0_beacon_attestation/ssz");
    });
      
  });

  describe("isAttestationSubnetTopic", () => {
    it("should return valid attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkValue,
          "ssz",
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

  describe("getGossipEvent", () => {
    it("should get correct GossipEvent", () => {
      expect(getGossipEvent(getGossipTopic(GossipEvent.BLOCK, forkValue))).to.be.equal(GossipEvent.BLOCK);
      expect(getGossipEvent(getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, forkValue))).to.be.equal(GossipEvent.AGGREGATE_AND_PROOF);
      expect(getGossipEvent(getGossipTopic(GossipEvent.ATTESTATION, forkValue))).to.be.equal(GossipEvent.ATTESTATION);
      expect(getGossipEvent(getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkValue))).to.be.equal(GossipEvent.VOLUNTARY_EXIT);
      expect(getGossipEvent(getGossipTopic(GossipEvent.PROPOSER_SLASHING, forkValue))).to.be.equal(GossipEvent.PROPOSER_SLASHING);
      expect(getGossipEvent(getGossipTopic(GossipEvent.ATTESTER_SLASHING, forkValue))).to.be.equal(GossipEvent.ATTESTER_SLASHING);
    });
  });

  describe("getSubnetFromAttestationSubnetTopic", () => {
    it("should get correct subnet from attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkValue,
          "ssz",
          new Map([["subnet", subnet.toString()]]),
        );
        expect(getSubnetFromAttestationSubnetTopic(topic)).to.be.equal(subnet);
      }
    });
  });
    
});
