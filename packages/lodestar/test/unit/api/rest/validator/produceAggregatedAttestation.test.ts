import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {produceAggregatedAttestation} from "../../../../../src/api/rest/controllers/validator";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "../index.test";

describe("rest - validator - produceAggregatedAttestation", function () {
  it("should succeed", async function () {
    const root = config.types.Root.defaultValue();
    this.test?.ctx?.validatorStub.getAggregatedAttestation.resolves(generateEmptyAttestation());
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAggregatedAttestation.url))
      .query({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        attestation_data_root: toHexString(root),
        slot: 0,
      })
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.undefined;
    expect(this.test?.ctx?.validatorStub.getAggregatedAttestation.withArgs(root, 0).calledOnce).to.be.true;
  });

  it("missing param", async function () {
    this.test?.ctx?.validatorStub.getAggregatedAttestation.resolves();
    await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAggregatedAttestation.url))
      .query({
        slot: 0,
      })
      .expect(400);
    expect(this.test?.ctx?.validatorStub.getAggregatedAttestation.notCalled).to.be.true;
  });
});
