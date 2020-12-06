import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {attesterDutiesController} from "../../../../../src/api/rest/controllers/validator/duties/attesterDuties";
import {silentLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "./index.test";
import {prepareCommitteeSubnet} from "../../../../../src/api/rest/controllers/validator/prepareCommitteeSubnet";

describe("rest - validator - prepareCommitteeSubnet", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.VALIDATOR],
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
    api.validator.prepareBeaconCommitteeSubnet.resolves();
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, prepareCommitteeSubnet.url))
      .send([
        {
          // eslint-disable-next-line @typescript-eslint/camelcase
          validator_index: 1,
          // eslint-disable-next-line @typescript-eslint/camelcase
          committee_index: 2,
          // eslint-disable-next-line @typescript-eslint/camelcase
          committees_at_slot: 64,
          slot: 0,
          // eslint-disable-next-line @typescript-eslint/camelcase
          is_aggregator: false,
        },
      ])
      .expect(200);
    expect(api.validator.prepareBeaconCommitteeSubnet.withArgs(1, 2, 64, 0, false).calledOnce).to.be.true;
  });

  it("missing param", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, prepareCommitteeSubnet.url))
      .send([
        {
          slot: 0,
        },
      ])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
