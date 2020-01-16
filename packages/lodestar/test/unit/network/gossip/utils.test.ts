import {describe, it} from "mocha";
import {getAttestationSubnetTopic, getGossipTopic, deserializeGossipMessage} from "../../../../src/network/gossip/utils";
import {GossipEvent} from "../../../../src/network/gossip/constants";
import {expect} from "chai";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {BeaconBlock} from "@chainsafe/eth2.0-types";
import {equals, serialize} from "@chainsafe/ssz";
import {generateEmptyBlock} from "../../../utils/block";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {GOSSIP_MAX_SIZE} from "../../../../src/constants";

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
  
  describe("handle gossip message", function () {
     
    it("should deserialize gossip message", function () {
      const block = generateEmptyBlock();
      const data = deserializeGossipMessage<BeaconBlock>(
        {data: serialize(config.types.BeaconBlock, block)},
        config.types.BeaconBlock
      );
      expect(equals(config.types.BeaconBlock, block, data)).to.be.true;
    });

    it("should fail to deserialize too large message", function () {
      const bytes = Buffer.alloc(GOSSIP_MAX_SIZE + 1);
      expect(() => deserializeGossipMessage<BeaconBlock>(
        {data: bytes},
        config.types.BeaconBlock
      )).to.throw();
    });
      
  });
    
});
