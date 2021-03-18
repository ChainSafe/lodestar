import {config} from "@chainsafe/lodestar-config/minimal";
import {SignedVoluntaryExit} from "@chainsafe/lodestar-types/phase0";
import {expect} from "chai";
import supertest from "supertest";
import {submitVoluntaryExit} from "../../../../../../src/api/rest/controllers/beacon/pool";
import {generateEmptySignedVoluntaryExit} from "../../../../../utils/attestation";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - submitVoluntaryExit", function () {
  let voluntaryExit: SignedVoluntaryExit;
  let restApi: RestApi;
  let beaconPoolStub: SinonStubbedInstance<BeaconPoolApi>;

  before(function () {
    voluntaryExit = generateEmptySignedVoluntaryExit();
  });

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
  });

  it("should succeed", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitVoluntaryExit.url))
      .send(config.types.phase0.SignedVoluntaryExit.toJson(voluntaryExit, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(beaconPoolStub.submitVoluntaryExit.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitVoluntaryExit.url))
      .send(config.types.phase0.SignedVoluntaryExit.toJson(voluntaryExit, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(beaconPoolStub.submitVoluntaryExit.notCalled).to.be.true;
  });
});
