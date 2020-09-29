import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {getPoolAttestations} from "../../../../../../src/api/rest/controllers/beacon/pool";
import {StubbedApi} from "../../../../../utils/stub/api";
import {generateAttestation} from "../../../../../utils/attestation";
import {silentLogger} from "../../../../../utils/logger";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";
import {getBlockRoot} from "../../../../../../src/api/rest/controllers/beacon/blocks";

describe("rest - beacon - getPoolAttestations", function () {
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
    api.beacon.pool.getAttestations.withArgs({committeeIndex: 1, slot: 1}).resolves([generateAttestation()]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getPoolAttestations.url))
      // eslint-disable-next-line @typescript-eslint/camelcase
      .query({slot: "1", committee_index: "1"})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });
});
