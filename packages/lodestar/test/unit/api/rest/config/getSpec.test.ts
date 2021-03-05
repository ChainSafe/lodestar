import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconParams} from "@chainsafe/lodestar-params";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX, api, restApi} from "./index.test";
import {getSpec} from "../../../../../src/api/rest/controllers/config";

describe("rest - config - getSpec", function () {
  it("ready", async function () {
    api.config.getSpec.resolves(config.params);
    const response = await supertest(restApi.server.server).get(urlJoin(CONFIG_PREFIX, getSpec.url)).expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.deep.equal(BeaconParams.toJson(config.params));
  });
});
