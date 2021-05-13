import {config} from "@chainsafe/lodestar-config/minimal";
import {AttesterSlashing} from "@chainsafe/lodestar-types/phase0";
import {expect} from "chai";
import supertest from "supertest";
import {submitPoolAttesterSlashings} from "../../../../../../src/api/rest/beacon/pool/submitPoolAttesterSlashings";
import {generateEmptyAttesterSlashing} from "../../../../../utils/slashings";
import {setupRestApiTestServer} from "../../index.test";
import {RestApi} from "../../../../../../src/api";
import {SinonStubbedInstance} from "sinon";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - submitPoolAttesterSlashings", function () {
  let slashing: AttesterSlashing;
  let restApi: RestApi;
  let beaconPoolStub: SinonStubbedInstance<BeaconPoolApi>;

  before(function () {
    slashing = generateEmptyAttesterSlashing();
  });

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
  });

  it("should succeed", async function () {
    await supertest(restApi.server.server)
      .post(submitPoolAttesterSlashings.url)
      .send(config.types.phase0.AttesterSlashing.toJson(slashing, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(beaconPoolStub.submitAttesterSlashing.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(restApi.server.server)
      .post(submitPoolAttesterSlashings.url)
      .send(config.types.phase0.AttesterSlashing.toJson(slashing, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(beaconPoolStub.submitAttesterSlashing.notCalled).to.be.true;
  });
});
