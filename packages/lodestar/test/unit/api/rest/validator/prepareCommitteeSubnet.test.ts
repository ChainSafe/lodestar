import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {testLogger} from "../../../../utils/logger";
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
        logger: testLogger(),
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
          // eslint-disable-next-line @typescript-eslint/naming-convention
          validator_index: 1,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          committee_index: 2,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          committees_at_slot: 64,
          slot: 0,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          is_aggregator: false,
        },
      ])
      .expect(200);
    expect(
      api.validator.prepareBeaconCommitteeSubnet.withArgs([
        {
          validatorIndex: 1,
          committeeIndex: 2,
          committeesAtSlot: 64,
          slot: 0,
          isAggregator: false,
        },
      ]).calledOnce
    ).to.be.true;
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
