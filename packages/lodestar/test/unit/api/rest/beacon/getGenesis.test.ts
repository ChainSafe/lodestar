import supertest from "supertest";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";

import {getGenesis} from "../../../../../src/api/rest/controllers/beacon";
import {urlJoin} from "../utils";
import {BEACON_PREFIX} from "../index.test";
import {BeaconApi, RestApi} from "../../../../../src/api";
import {SinonStubbedInstance} from "sinon";

describe("rest - beacon - getGenesis", function () {
  let beaconStub: SinonStubbedInstance<BeaconApi>;
  let restApi: RestApi;

  beforeEach(function () {
    beaconStub = this.test?.ctx?.beaconStub;
    restApi = this.test?.ctx?.restApi;
  });

  it("should get genesis object", async function () {
    beaconStub.getGenesis.resolves({
      genesisForkVersion: config.params.GENESIS_FORK_VERSION,
      genesisTime: BigInt(0),
      genesisValidatorsRoot: Buffer.alloc(32),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getGenesis.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.genesis_time).to.equal("0");
    expect(response.body.data.genesis_validators_root).to.not.be.empty;
  });

  it("should return 404 if no genesis", async function () {
    beaconStub.getGenesis.resolves(null);
    await supertest(restApi.server.server).get(urlJoin(BEACON_PREFIX, getGenesis.url)).expect(404);
  });
});
