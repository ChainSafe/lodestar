import {config} from "@chainsafe/lodestar-config/minimal";
import {SignedVoluntaryExit} from "@chainsafe/lodestar-types/lib/phase0";
import {expect} from "chai";
import supertest from "supertest";
import {submitVoluntaryExit} from "../../../../../../src/api/rest/controllers/beacon/pool";
import {generateEmptySignedVoluntaryExit} from "../../../../../utils/attestation";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../../index.test";

describe("rest - beacon - submitVoluntaryExit", function () {
  let voluntaryExit: SignedVoluntaryExit;

  before(function () {
    voluntaryExit = generateEmptySignedVoluntaryExit();
  });

  it("should succeed", async function () {
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitVoluntaryExit.url))
      .send(config.types.phase0.SignedVoluntaryExit.toJson(voluntaryExit, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(this.test?.ctx?.beaconPoolStub.submitVoluntaryExit.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitVoluntaryExit.url))
      .send(config.types.phase0.SignedVoluntaryExit.toJson(voluntaryExit, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(this.test?.ctx?.beaconPoolStub.submitVoluntaryExit.notCalled).to.be.true;
  });
});
