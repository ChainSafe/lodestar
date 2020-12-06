import {expect} from "chai";
import supertest from "supertest";

import {List} from "@chainsafe/ssz";
import {Attestation} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";

import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {StubbedApi} from "../../../../../utils/stub/api";
import {getBlockAttestations} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateSignedBlock} from "../../../../../utils/block";
import {generateEmptyAttestation} from "../../../../../utils/attestation";
import {silentLogger} from "../../../../../utils/logger";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";

describe("rest - beacon - getBlockAttestations", function () {
  const opts = {
    api: [ApiNamespace.BEACON],
    cors: "*",
    enabled: true,
    host: "127.0.0.1",
    port: 0,
  };
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(opts, {
      config,
      logger: silentLogger,
      api,
    });
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    api.beacon.blocks.getBlock.withArgs("head").resolves(
      generateSignedBlock({
        message: {
          body: {
            attestations: [generateEmptyAttestation(), generateEmptyAttestation()] as List<Attestation>,
          },
        },
      })
    );
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.equal(2);
  });

  it("should not found block", async function () {
    api.beacon.blocks.getBlock.withArgs("4").resolves(null);
    await supertest(restApi.server.server).get(
        urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "4"))
    ).expect(404);
  });

  it("should fail validation", async function () {
    api.beacon.blocks.getBlock.throws(new Error("Invalid block id"));
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
