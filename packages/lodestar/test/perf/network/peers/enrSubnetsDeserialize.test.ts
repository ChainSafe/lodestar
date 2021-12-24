import {itBench} from "@dapplion/benchmark";
import {SYNC_COMMITTEE_SUBNET_COUNT, ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {deserializeEnrSubnets} from "../../../../src/network/peers/utils/enrSubnetsDeserialize";

/**
 * Ideally we want to sleep between requests to test the prune.
 * But adding sinon mock timer here make it impossible to benchmark.
 */
describe("network / peers / deserializeEnrSubnets", () => {
  const attnets = Buffer.from("feffb7f7fdfffefd", "hex");
  const syncnets = Buffer.from("04", "hex");

  before("Validate constants", () => {
    expect(ATTESTATION_SUBNET_COUNT).to.equal(64, "ATTESTATION_SUBNET_COUNT changed");
    expect(SYNC_COMMITTEE_SUBNET_COUNT).to.equal(4, "SYNC_COMMITTEE_SUBNET_COUNT changed");
  });

  itBench({
    id: "enrSubnets - fastDeserialize 64 bits",
    fn: () => {
      deserializeEnrSubnets(attnets, ATTESTATION_SUBNET_COUNT);
    },
  });

  itBench({
    id: "enrSubnets - ssz BitVector 64 bits",
    fn: () => {
      ssz.phase0.AttestationSubnets.deserialize(attnets);
    },
  });

  itBench({
    id: "enrSubnets - fastDeserialize 4 bits",
    fn: () => {
      deserializeEnrSubnets(syncnets, SYNC_COMMITTEE_SUBNET_COUNT);
    },
  });

  itBench({
    id: "enrSubnets - ssz BitVector 4 bits",
    fn: () => {
      ssz.altair.SyncSubnets.deserialize(syncnets);
    },
  });
});
