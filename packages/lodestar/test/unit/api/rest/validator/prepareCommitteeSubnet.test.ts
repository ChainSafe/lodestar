import {expect} from "chai";
import supertest from "supertest";
import {urlJoin} from "../utils";
import {setupRestApiTestServer, VALIDATOR_PREFIX} from "../index.test";
import {prepareCommitteeSubnet} from "../../../../../src/api/rest/controllers/validator/prepareCommitteeSubnet";
import {SinonStubbedInstance} from "sinon";
import {RestApi, ValidatorApi} from "../../../../../src/api";

describe("rest - validator - prepareCommitteeSubnet", function () {
  let restApi: RestApi;
  let validatorStub: SinonStubbedInstance<ValidatorApi>;

  before(async function () {
    restApi = await setupRestApiTestServer();
    validatorStub = restApi.server.api.validator as SinonStubbedInstance<ValidatorApi>;
  });

  it("should succeed", async function () {
    validatorStub.prepareBeaconCommitteeSubnet.resolves();
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
      validatorStub.prepareBeaconCommitteeSubnet.withArgs([
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
