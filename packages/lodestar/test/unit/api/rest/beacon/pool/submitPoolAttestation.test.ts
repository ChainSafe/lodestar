import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {setupRestApiTestServer} from "../../index.test";
import {generateAttestation} from "../../../../../utils/attestation";
import {submitPoolAttestations} from "../../../../../../src/api/rest/beacon/pool/submitPoolAttestations";
import {Attestation} from "@chainsafe/lodestar-types/phase0";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - submitPoolAttestations", function () {
  let attestation: Attestation;
  let restApi: RestApi;
  let beaconPoolStub: SinonStubbedInstance<BeaconPoolApi>;

  before(function () {
    attestation = generateAttestation();
  });

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
  });

  it("should succeed", async function () {
    await supertest(restApi.server.server)
      .post(submitPoolAttestations.url)
      .send([config.types.phase0.Attestation.toJson(attestation, {case: "snake"}) as Record<string, unknown>])
      .expect(200);
    expect(beaconPoolStub.submitAttestations.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    await supertest(restApi.server.server)
      .post(submitPoolAttestations.url)
      .send([config.types.phase0.Attestation.toJson(attestation, {case: "camel"}) as Record<string, unknown>])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(beaconPoolStub.submitAttestations.notCalled).to.be.true;
  });
});
