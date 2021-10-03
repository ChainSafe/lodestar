import {expect} from "chai";
import {ssz} from "../../src";

describe("size", function () {
  it("should calculate correct minSize and maxSize", () => {
    const minSize = ssz.phase0.BeaconState.minSize();
    const maxSize = ssz.phase0.BeaconState.maxSize();
    // https://gist.github.com/protolambda/db75c7faa1e94f2464787a480e5d613e
    expect(minSize).to.be.equal(2687377);
    expect(maxSize).to.be.equal(141837543039377);
  });
});

describe("container serialization/deserialization field casing(s)", function () {
  it("AttesterSlashing", function () {
    const test = {
      attestation1: ssz.phase0.IndexedAttestation.defaultValue(),
      attestation2: ssz.phase0.IndexedAttestation.defaultValue(),
    };
    const json = {
      attestation_1: ssz.phase0.IndexedAttestation.toJson(test.attestation1, {case: "snake"}),
      attestation_2: ssz.phase0.IndexedAttestation.toJson(test.attestation2, {case: "snake"}),
    };

    const result = ssz.phase0.AttesterSlashing.fromJson(json, {
      case: "snake",
    });
    expect(ssz.phase0.AttesterSlashing.equals(test, result)).to.be.true;
    const back = ssz.phase0.AttesterSlashing.toJson(result, {
      case: "snake",
    });
    expect(back).to.be.deep.equal(json);
  });

  it("ProposerSlashing", function () {
    const test = {
      signedHeader1: ssz.phase0.SignedBeaconBlockHeader.defaultValue(),
      signedHeader2: ssz.phase0.SignedBeaconBlockHeader.defaultValue(),
    };
    const json = {
      signed_header_1: ssz.phase0.SignedBeaconBlockHeader.toJson(test.signedHeader1, {case: "snake"}),
      signed_header_2: ssz.phase0.SignedBeaconBlockHeader.toJson(test.signedHeader2, {case: "snake"}),
    };

    const result = ssz.phase0.ProposerSlashing.fromJson(json, {
      case: "snake",
    });
    expect(ssz.phase0.ProposerSlashing.equals(test, result)).to.be.true;
    const back = ssz.phase0.ProposerSlashing.toJson(result, {
      case: "snake",
    });
    expect(back).to.be.deep.equal(json);
  });
});
