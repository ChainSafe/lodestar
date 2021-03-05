import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";
import {generateAttestation} from "../../../../../utils/attestation";
import {submitPoolAttestation} from "../../../../../../src/api/rest/controllers/beacon/pool/submitPoolAttestation";

describe("rest - beacon - submitAttestation", function () {
  it("should succeed", async function () {
    const attestation = generateAttestation();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitPoolAttestation.url))
      .send(config.types.phase0.Attestation.toJson(attestation, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(api.beacon.pool.submitAttestation.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    const attestation = generateAttestation();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitPoolAttestation.url))
      .send(config.types.phase0.Attestation.toJson(attestation, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(api.beacon.pool.submitAttestation.notCalled).to.be.true;
  });
});
