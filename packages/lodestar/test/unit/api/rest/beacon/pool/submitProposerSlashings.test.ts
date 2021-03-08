import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";
import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {submitProposerSlashing} from "../../../../../../src/api/rest/controllers/beacon/pool/submitProposerSlashing";
import {ProposerSlashing} from "@chainsafe/lodestar-types/lib/phase0";

describe("rest - beacon - submitProposerSlashing", function () {
  let slashing: ProposerSlashing;

  before(function () {
    slashing = generateEmptyProposerSlashing();
  });

  it("should succeed", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitProposerSlashing.url))
      .send(config.types.phase0.ProposerSlashing.toJson(slashing, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(api.beacon.pool.submitProposerSlashing.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitProposerSlashing.url))
      .send(config.types.phase0.ProposerSlashing.toJson(slashing, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(api.beacon.pool.submitProposerSlashing.notCalled).to.be.true;
  });
});
