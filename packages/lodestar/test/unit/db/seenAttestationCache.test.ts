import {config} from "@chainsafe/lodestar-config/default";
import {BitList} from "@chainsafe/ssz";
import {expect} from "chai";
import {SeenAttestationCache} from "../../../src/db/seenAttestationCache";
import {generateEmptyAggregateAndProof} from "../../utils/attestation";

describe("SeenAttestationCache", function () {
  let cache: SeenAttestationCache;
  beforeEach(() => {
    cache = new SeenAttestationCache(config);
    const aggProof = generateEmptyAggregateAndProof();
    aggProof.aggregate.aggregationBits = [true, false, true] as BitList;
    cache.addAggregateAndProof(aggProof);
  });

  it("should found an AggregateAndProof with subset attesters", () => {
    const aggProof = generateEmptyAggregateAndProof();
    aggProof.aggregate.aggregationBits = [true, false, false] as BitList;
    expect(cache.hasAggregateAndProof(aggProof)).to.be.true;
  });

  it("should not found an AggregateAndProof with different attesters", () => {
    const aggProof = generateEmptyAggregateAndProof();
    aggProof.aggregate.aggregationBits = [false, true, false] as BitList;
    expect(cache.hasAggregateAndProof(aggProof)).to.be.false;
    cache.addAggregateAndProof(aggProof);
    expect(cache.hasAggregateAndProof(aggProof)).to.be.true;
  });

  it("should not found an AggregateAndProof with different AttestationDelta", () => {
    const aggProof = generateEmptyAggregateAndProof();
    aggProof.aggregate.data.slot = 2021;
    expect(cache.hasAggregateAndProof(aggProof)).to.be.false;
  });
});
