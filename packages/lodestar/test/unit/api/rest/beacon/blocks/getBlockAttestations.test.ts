import {RestApi} from "../../../../../../src/api/rest";
import {List} from "@chainsafe/ssz";
import {Attestation} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {ValidatorApi} from "../../../../../../src/api/impl/validator";
import sinon from "sinon";
import {ApiNamespace} from "../../../../../../src/api";
import {StubbedBeaconApi} from "../../../../../utils/stub/beaconApi";
import supertest from "supertest";
import {expect} from "chai";
import {getBlockAttestations} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateSignedBlock} from "../../../../../utils/block";
import {generateEmptyAttestation} from "../../../../../utils/attestation";
import {StubbedNodeApi} from "../../../../../utils/stub/nodeApi";
import {silentLogger} from "../../../../../utils/logger";

describe("rest - beacon - getBlockAttestations", function () {
  let api: RestApi;
  let beaconApiStub: StubbedBeaconApi;

  beforeEach(async function () {
    beaconApiStub = new StubbedBeaconApi();
    api = new RestApi(
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
        validator: sinon.createStubInstance(ValidatorApi),
        node: new StubbedNodeApi(),
        beacon: beaconApiStub,
      }
    );
    await api.start();
  });

  afterEach(async function () {
    await api.stop();
  });

  it("should succeed", async function () {
    beaconApiStub.blocks.getBlock.withArgs("head").resolves(
      generateSignedBlock({
        message: {
          body: {
            attestations: [generateEmptyAttestation(), generateEmptyAttestation()] as List<Attestation>,
          },
        },
      })
    );
    const response = await supertest(api.server.server)
      .get(getBlockAttestations.url.replace(":blockId", "head"))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.equal(2);
  });

  it("should not found block", async function () {
    beaconApiStub.blocks.getBlock.withArgs("4").resolves(null);
    await supertest(api.server.server).get(getBlockAttestations.url.replace(":blockId", "4")).expect(404);
  });

  it("should fail validation", async function () {
    beaconApiStub.blocks.getBlock.throws(new Error("Invalid block id"));
    await supertest(api.server.server)
      .get(getBlockAttestations.url.replace(":blockId", "abc"))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
