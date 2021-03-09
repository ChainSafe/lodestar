import {config} from "@chainsafe/lodestar-config/minimal";
import {AttesterSlashing} from "@chainsafe/lodestar-types/lib/phase0";
import {expect} from "chai";
import supertest from "supertest";
import {submitAttesterSlashing} from "../../../../../../src/api/rest/controllers/beacon/pool";
import {generateEmptyAttesterSlashing} from "../../../../../utils/slashings";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../../index.test";

describe("rest - beacon - submitAttesterSlashing", function () {
  let slashing: AttesterSlashing;

  before(function () {
    slashing = generateEmptyAttesterSlashing();
  });

  it("should succeed", async function () {
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitAttesterSlashing.url))
      .send(config.types.phase0.AttesterSlashing.toJson(slashing, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(this.test?.ctx?.beaconPoolStub.submitAttesterSlashing.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitAttesterSlashing.url))
      .send(config.types.phase0.AttesterSlashing.toJson(slashing, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(this.test?.ctx?.beaconPoolStub.submitAttesterSlashing.notCalled).to.be.true;
  });
});
