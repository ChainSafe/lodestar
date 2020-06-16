import {expect} from "chai";
import {afterEach, describe, it} from "mocha";
import supertest from "supertest";
import sinon, {SinonStubbedInstance} from "sinon";

import {toHexString} from "@chainsafe/ssz";
import {Attestation} from "@chainsafe/lodestar-types";
import {Keypair} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {RestApi} from "../../../../../src/api/rest";
import {ApiNamespace} from "../../../../../src/api";
import {generateEmptyAttesterDuty} from "../../../../../src/chain/factory/duties";
import {generateEmptyBlock} from "../../../../utils/block";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation,
  generateEmptySignedAggregateAndProof
} from "../../../../utils/attestation";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {BeaconApi} from "../../../../../src/api/impl/beacon";

describe("Test validator rest API", function () {

  let restApi: RestApi, validatorApi: SinonStubbedInstance<ValidatorApi>, beaconApi: SinonStubbedInstance<BeaconApi>;
  const sandbox = sinon.createSandbox();

  beforeEach(async function () {
    validatorApi = sandbox.createStubInstance(ValidatorApi);
    beaconApi = sandbox.createStubInstance(BeaconApi);
    restApi = new RestApi({
      api: [ApiNamespace.VALIDATOR],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      logger: sandbox.createStubInstance(WinstonLogger),
      config,
      validator: validatorApi,
      beacon: beaconApi
    });
    return await restApi.start();
  });

  afterEach(async function () {
    await restApi.stop();
    sandbox.restore();
  });

  it("should return proposer duties", async function () {
    validatorApi.getProposerDuties.resolves([{slot: 1, proposerPubkey: Buffer.alloc(48)}]);
    const response = await supertest(restApi.server.server)
      .get(
        "/validator/duties/2/proposer",
      )
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body[0].proposer_pubkey).to.be.equal(toHexString(Buffer.alloc(48)));
    expect(validatorApi.getProposerDuties.withArgs(2).calledOnce).to.be.true;
  });

  it("should return attester duties", async function () {
    const publicKey1= Keypair.generate().publicKey.toBytesCompressed();
    validatorApi.getAttesterDuties.resolves([generateEmptyAttesterDuty(Buffer.alloc(48, 1))]);
    const response = await supertest(restApi.server.server)
      .get(
        "/validator/duties/2/attester",
      )
      .query({"validator_pubkeys": [toHexString(publicKey1)]})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.length).to.be.equal(1);
    expect(validatorApi.getAttesterDuties.withArgs(
      2, sinon.match.any
    ).calledOnce).to.be.true;
  });

  it("should publish aggregate and proof", async function () {
    const signedAggregateAndProof = generateEmptySignedAggregateAndProof();
    await supertest(restApi.server.server)
      .post(
        "/validator/aggregate_and_proof",
      )
      .send([config.types.SignedAggregateAndProof.toJson(signedAggregateAndProof, {case: "snake"}) as object])
      .expect(200);
    expect(validatorApi.publishAggregateAndProof.calledOnce).to.be.true;
  });

  it("should throw error on invalid request for block production", async function () {
    await supertest(restApi.server.server)
      .get("/validator/block")
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("should return new block", async function () {
    const block = generateEmptyBlock();
    validatorApi.produceBlock.resolves(block);
    const response = await supertest(restApi.server.server)
      .get(
        "/validator/block",
      )
      .query({
        "randao_reveal": toHexString(Buffer.alloc(32)),
        "proposer_pubkey": toHexString(Buffer.alloc(48)),
        slot: 2,
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.parent_root).to.not.be.null;
  });

  it("should publish block", async function () {
    const block = {message: generateEmptyBlock(), signature: Buffer.alloc(96)};
    await supertest(restApi.server.server)
      .post(
        "/validator/block",
      )
      .send(config.types.SignedBeaconBlock.toJson(block, {case: "snake"}) as object)
      .expect(200)
      .expect("Content-Type", "application/json");
    expect(validatorApi.publishBlock.calledOnce).to.be.true;
  });

  it("should produce attestation", async function () {
    const attestation: Attestation = generateAttestation({
      data: generateAttestationData(0, 1)
    });
    validatorApi.produceAttestation.resolves(attestation);
    await supertest(restApi.server.server)
      .get(
        "/validator/attestation",
      )
      .query({
        "validator_pubkey": toHexString(Buffer.alloc(48)),
        "attestation_committee_index": 3,
        "slot": 2
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(validatorApi.produceAttestation.withArgs(sinon.match.any, 3, 2).calledOnce).to.be.true;
  });


  it("should publish attestation", async function () {
    const attestation = generateEmptyAttestation();
    await supertest(restApi.server.server)
      .post(
        "/validator/attestation",
      )
      .send([config.types.Attestation.toJson(attestation, {case: "snake"}) as object])
      .expect(200)
      .expect("Content-Type", "application/json");
    expect(validatorApi.publishAttestation.calledOnce).to.be.true;
  });

  it("should get wire attestations", async function() {

    const attestation = generateAttestation({
      data: generateAttestationData(1, 1, 1, 1)
    });
    validatorApi.getWireAttestations.resolves([attestation]);

    const response = await supertest(restApi.server.server)
      .get("/validator/wire_attestations")
      .query({
        "committee_index": 1,
        "epoch": 0
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");

    expect(response.body.length).to.be.equal(1);
    expect(validatorApi.getWireAttestations.withArgs(0, 1).calledOnce).to.be.true;

  });

});
