import {expect} from "chai";
import bls from "@chainsafe/bls";
import {phase0, ssz} from "@lodestar/types";
import {PointFormat} from "@chainsafe/bls/types";
import {BitArray} from "@chainsafe/ssz";
import {AttestationPool} from "../../../../lib/chain/opPools/attestationPool.js";
import {generateAttestation} from "../../../utils/attestation.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";

describe("chain / opPools / attestationPool", function () {
  let pool: AttestationPool;
  const index = 2;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  let attestation: phase0.Attestation;
  const participantIndex = 1;

  before(() => {
    const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    attestation = generateAttestation({
      data: {
        slot,
        beaconBlockRoot,
        index,
      },
    });
    attestation.aggregationBits = new BitArray(new Uint8Array([0]), 8);
    attestation.aggregationBits.set(participantIndex, true);
    attestation.signature = sk
      .sign(ssz.phase0.AttestationData.hashTreeRoot(attestation.data))
      .toBytes(PointFormat.compressed);
  });

  beforeEach(() => {
    pool = new AttestationPool();
    pool.add(attestation);
  });

  it("should return the cached aggregated attestation", () => {
    const aggregated = pool.getAggregate(slot, ssz.phase0.AttestationData.hashTreeRoot(attestation.data));
    expect(aggregated).to.be.not.null;
    expect(pool.getAggregate(slot, ssz.phase0.AttestationData.hashTreeRoot(attestation.data))).to.be.equal(aggregated);
  });

  it("should return new aggregated attestation", () => {
    const firstAggregated = pool.getAggregate(slot, ssz.phase0.AttestationData.hashTreeRoot(attestation.data));
    expect(firstAggregated).to.be.not.null;
    const sk2 = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    const attestation2 = generateAttestation({
      data: {
        slot,
        beaconBlockRoot,
        index,
      },
    });
    attestation2.aggregationBits = new BitArray(new Uint8Array([0]), 8);
    const participantIndex2 = 2;
    attestation2.aggregationBits.set(participantIndex2, true);
    attestation2.signature = sk2
      .sign(ssz.phase0.AttestationData.hashTreeRoot(attestation2.data))
      .toBytes(PointFormat.compressed);
    const outcome = pool.add(attestation2);

    expect(outcome).to.be.equal(InsertOutcome.Aggregated);
    const aggregated = pool.getAggregate(slot, ssz.phase0.AttestationData.hashTreeRoot(attestation.data));
    expect(aggregated).to.be.not.equal(firstAggregated);
    expect(ssz.phase0.AttestationData.equals(aggregated.data, attestation.data)).to.be.true;
    for (const i of [participantIndex, participantIndex2]) {
      expect(aggregated.aggregationBits.get(i)).to.be.true;
    }
  });
});
