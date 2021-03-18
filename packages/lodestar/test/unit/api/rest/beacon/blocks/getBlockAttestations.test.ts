import {expect} from "chai";
import supertest from "supertest";

import {List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";

import {getBlockAttestations} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateSignedBlock} from "../../../../../utils/block";
import {generateEmptyAttestation} from "../../../../../utils/attestation";
import {ApiResponseBody, urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../../../../src/api/impl/beacon/blocks";

describe("rest - beacon - getBlockAttestations", function () {
  let beaconBlocksStub: SinonStubbedInstance<IBeaconBlocksApi>;
  let restApi: RestApi;

  before(async function () {
    restApi = await setupRestApiTestServer();
    beaconBlocksStub = restApi.server.api.beacon.blocks as SinonStubbedInstance<BeaconBlockApi>;
  });

  after(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    beaconBlocksStub.getBlock.withArgs("head").resolves(
      generateSignedBlock({
        message: {
          body: {
            attestations: [generateEmptyAttestation(), generateEmptyAttestation()] as List<phase0.Attestation>,
          },
        },
      })
    );
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data.length).to.equal(2);
  });

  it("should not found block", async function () {
    beaconBlocksStub.getBlock.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "4")))
      .expect(404);
  });

  it("should fail validation", async function () {
    beaconBlocksStub.getBlock.throws(new Error("Invalid block id"));
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
