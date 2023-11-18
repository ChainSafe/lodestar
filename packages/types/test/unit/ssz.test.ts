import {expect} from "chai";
import {ssz} from "../../src/index.js";
import {SLOTS_PER_EPOCH} from "@lodestar/params";

describe("size", function () {
  it("should calculate correct minSize and maxSize", () => {
    const minSize = ssz.phase0.BeaconState.minSize;
    const maxSize = ssz.phase0.BeaconState.maxSize;
    // https://gist.github.com/protolambda/db75c7faa1e94f2464787a480e5d613e
    expect(minSize).to.be.equal(2687377);
    expect(maxSize).to.be.equal(141837543039377);
  });
});

describe("container serialization/deserialization field casing(s)", function () {
  it("AttesterSlashing", function () {
    const epochs = [0, 10, 1_000_000];
    for (const epoch of epochs) {
      const test = {
        attestation1: ssz.phase0.IndexedAttestation.defaultValue(),
        attestation2: ssz.phase0.IndexedAttestation.defaultValue(),
      };
      test.attestation1.data.slot = epoch * SLOTS_PER_EPOCH;
      test.attestation1.data.source.epoch = epoch;
      test.attestation1.data.target.epoch = epoch + 1;
      const json = {
        attestation_1: ssz.phase0.IndexedAttestation.toJson(test.attestation1),
        attestation_2: ssz.phase0.IndexedAttestation.toJson(test.attestation2),
      };
      const result = ssz.phase0.AttesterSlashing.fromJson(json);
      const back = ssz.phase0.AttesterSlashing.toJson(result);
      expect(back).to.be.deep.equal(json);
    }
  });

  it("ProposerSlashing", function () {
    const test = {
      signedHeader1: ssz.phase0.SignedBeaconBlockHeader.defaultValue(),
      signedHeader2: ssz.phase0.SignedBeaconBlockHeader.defaultValue(),
    };
    const json = {
      signed_header_1: ssz.phase0.SignedBeaconBlockHeader.toJson(test.signedHeader1),
      signed_header_2: ssz.phase0.SignedBeaconBlockHeader.toJson(test.signedHeader2),
    };

    const result = ssz.phase0.ProposerSlashing.fromJson(json);
    const back = ssz.phase0.ProposerSlashing.toJson(result);
    expect(back).to.be.deep.equal(json);
  });
});
