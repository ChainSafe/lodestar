import {expect} from "chai";
import {isUnaggregatedAttestation} from "../../../src/util/attestation";
import {generateEmptyAttestation} from "../../utils/attestation";

describe("validate unaggregated attestation", () => {
  it("should return invalid unaggregated attestation", () => {
    expect(isUnaggregatedAttestation(generateEmptyAttestation())).to.be.false;
  });

  it("should return valid unaggregated attestation", () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    expect(isUnaggregatedAttestation(attestation)).to.be.equal(true);
  });
});
