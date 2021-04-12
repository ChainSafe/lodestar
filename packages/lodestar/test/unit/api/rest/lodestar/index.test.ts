import supertest from "supertest";

import {getLatestWeakSubjectivityCheckpointEpoch} from "../../../../../src/api/rest/lodestar";
import {urlJoin} from "../utils";
import {LODESTAR_PREFIX, setupRestApiTestServer} from "../index.test";
import {RestApi} from "../../../../../src/api";
import {StubbedLodestarApi} from "../../../../utils/stub/lodestarApi";

describe("rest - lodestar - getLatestWeakSubjectivityCheckpointEpoch", function () {
  let restApi: RestApi;
  let lodestarApiStub: StubbedLodestarApi;

  before(async function () {
    restApi = await setupRestApiTestServer();
    lodestarApiStub = restApi.server.api.lodestar as StubbedLodestarApi;
  });

  it("success", async function () {
    lodestarApiStub.getLatestWeakSubjectivityCheckpointEpoch.resolves(0);
    await supertest(restApi.server.server)
      .get(urlJoin(LODESTAR_PREFIX, getLatestWeakSubjectivityCheckpointEpoch.url))
      .expect(200);
  });
});
