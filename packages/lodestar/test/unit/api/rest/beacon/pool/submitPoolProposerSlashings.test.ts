import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {setupRestApiTestServer} from "../../index.test";
import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {submitPoolProposerSlashings} from "../../../../../../src/api/rest/beacon/pool/submitPoolProposerSlashings";
import {ProposerSlashing} from "@chainsafe/lodestar-types/phase0";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - submitPoolProposerSlashings", function () {
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
      .post(submitPoolProposerSlashings.url)
      .send(config.types.phase0.ProposerSlashing.toJson(slashing, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(beaconPoolStub.submitProposerSlashing.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(restApi.server.server)
      .post(submitPoolProposerSlashings.url)
      .send(config.types.phase0.ProposerSlashing.toJson(slashing, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(beaconPoolStub.submitProposerSlashing.notCalled).to.be.true;
  });
});
