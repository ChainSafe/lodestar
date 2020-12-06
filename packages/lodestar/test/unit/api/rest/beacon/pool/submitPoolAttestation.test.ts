import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {silentLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";
import {generateAttestation} from "../../../../../utils/attestation";
import {submitPoolAttestation} from "../../../../../../src/api/rest/controllers/beacon/pool/submitPoolAttestation";

describe("rest - beacon - submitAttestation", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.BEACON],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        config,
        logger: silentLogger,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    const attestation = generateAttestation();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitPoolAttestation.url))
      .send(config.types.Attestation.toJson(attestation, {case: "snake"}) as object)
      .expect(200);
    expect(api.beacon.pool.submitAttestation.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    const attestation = generateAttestation();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitPoolAttestation.url))
      .send(config.types.Attestation.toJson(attestation, {case: "camel"}) as object)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(api.beacon.pool.submitAttestation.notCalled).to.be.true;
  });
});
