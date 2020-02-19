import {describe, it} from "mocha";
import {getAttestationSubnetTopic, getGossipTopic, isAttestationSubnetTopic, getSubnetFromAttestationSubnetTopic} from "../../../../src/network/gossip/utils";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {expect} from "chai";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {ATTESTATION_SUBNET_COUNT} from "../../../../src/constants";

describe("gossip utils", function () {
   
  describe("getGossipTopic", function () {
      
    it("should get gossip topic with default encoding", function () {
      const topic = getGossipTopic(GossipEvent.BLOCK);
      expect(topic).to.be.equal("/eth2/beacon_block/ssz");
    });

    it("should get gossip topic with different encoding", function () {
      const topic = getGossipTopic(GossipEvent.BLOCK, "ssz_snappy");
      expect(topic).to.be.equal("/eth2/beacon_block/ssz_snappy");
    });

    it("should get gossip topic with params", function () {
      const topic = getGossipTopic(
        "/eth2/{param1}/{param2}" as GossipEvent,
        "ssz",
        new Map([["param1", "test"], ["param2", "test2"]])
      );
      expect(topic).to.be.equal("/eth2/test/test2/ssz");
    });

    it("get attestation subnet topic", function () {
      const topic = getAttestationSubnetTopic(generateEmptyAttestation());
      expect(topic).to.be.equal("/eth2/committee_index0_beacon_attestation/ssz");
    });
      
  });

  describe("isAttestationSubnetTopic", () => {
    it("should return valid attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
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

  describe("getSubnetFromAttestationSubnetTopic", () => {
    it("should get correct subnet from attestation subnet topic", () => {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          "ssz",
          new Map([["subnet", subnet.toString()]]),
        );
        expect(getSubnetFromAttestationSubnetTopic(topic)).to.be.equal(subnet);
      }
    });
  });
    
});
