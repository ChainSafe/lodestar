import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Attestation} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import sinon from "sinon";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation,
  generateEmptySignedAggregateAndProof,
} from "../../../../utils/attestation";
import {generateEmptyBlock} from "../../../../utils/block";
import {StubbedApi} from "../../../../utils/stub/api";

export const VALIDATOR_PREFIX = "/eth/v1/validator";

describe("Test validator rest API", function () {
  let restApi: RestApi, api: StubbedApi;
  const sandbox = sinon.createSandbox();

  beforeEach(async function () {
    api = new StubbedApi(sandbox);
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.VALIDATOR],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        logger: sandbox.createStubInstance(WinstonLogger),
        config,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
    sandbox.restore();
  });

  it("should publish aggregate and proof", async function () {
    const signedAggregateAndProof = generateEmptySignedAggregateAndProof();
    await supertest(restApi.server.server)
      .post("/validator/aggregate_and_proof")
      .send([config.types.SignedAggregateAndProof.toJson(signedAggregateAndProof, {case: "snake"}) as object])
      .expect(200);
    expect(api.validator.publishAggregateAndProof.calledOnce).to.be.true;
  });

  it("should produce attestation", async function () {
    const attestation: Attestation = generateAttestation({
      data: generateAttestationData(0, 1),
    });
    api.validator.produceAttestation.resolves(attestation);
    await supertest(restApi.server.server)
      .get("/validator/attestation")
      .query({
        // eslint-disable-next-line @typescript-eslint/camelcase
        validator_pubkey: toHexString(Buffer.alloc(48)),
        // eslint-disable-next-line @typescript-eslint/camelcase
        attestation_committee_index: 3,
        slot: 2,
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(api.validator.produceAttestation.withArgs(sinon.match.any, 3, 2).calledOnce).to.be.true;
  });

  it("should publish attestation", async function () {
    const attestation = generateEmptyAttestation();
    await supertest(restApi.server.server)
      .post("/validator/attestation")
      .send([config.types.Attestation.toJson(attestation, {case: "snake"}) as object])
      .expect(200)
      .expect("Content-Type", "application/json");
    expect(api.validator.publishAttestation.calledOnce).to.be.true;
  });

  it("should get wire attestations", async function () {
    const attestation = generateAttestation({
      data: generateAttestationData(1, 1, 1, 1),
    });
    api.validator.getWireAttestations.resolves([attestation]);

    const response = await supertest(restApi.server.server)
      .get("/validator/wire_attestations")
      .query({
        // eslint-disable-next-line @typescript-eslint/camelcase
        committee_index: 1,
        epoch: 0,
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");

    expect(response.body.length).to.be.equal(1);
    expect(api.validator.getWireAttestations.withArgs(0, 1).calledOnce).to.be.true;
  });
});
