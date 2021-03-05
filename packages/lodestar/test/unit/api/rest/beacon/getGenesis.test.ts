import supertest from "supertest";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";

import {getGenesis} from "../../../../../src/api/rest/controllers/beacon";
import {urlJoin} from "../utils";
import {BEACON_PREFIX, api, restApi} from "./index.test";

describe("rest - beacon - getGenesis", function () {
  it("should get genesis object", async function () {
    api.beacon.getGenesis.resolves({
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
    api.beacon.getGenesis.resolves(null);
    await supertest(restApi.server.server).get(urlJoin(BEACON_PREFIX, getGenesis.url)).expect(404);
  });
});
