import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {submitProposerSlashing} from "../../../../../../src/api/rest/controllers/beacon/pool/submitProposerSlashing";
import {ProposerSlashing} from "@chainsafe/lodestar-types/phase0";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - submitProposerSlashing", function () {
  let slashing: ProposerSlashing;
  let restApi: RestApi;
  let beaconPoolStub: SinonStubbedInstance<BeaconPoolApi>;

  before(function () {
    slashing = generateEmptyProposerSlashing();
  });

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
  });

  it("should succeed", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitProposerSlashing.url))
      .send(config.types.phase0.ProposerSlashing.toJson(slashing, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(beaconPoolStub.submitProposerSlashing.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitProposerSlashing.url))
      .send(config.types.phase0.ProposerSlashing.toJson(slashing, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(beaconPoolStub.submitProposerSlashing.notCalled).to.be.true;
  });
});
