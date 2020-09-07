import {expect} from "chai";
import sinon from "sinon";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getNetworkIdentity} from "../../../../../src/api/rest/controllers/node/getNetworkIdentity";
import {StubbedApi} from "../../../../utils/stub/api";
import {silentLogger} from "../../../../utils/logger";

describe("rest - node - getNetworkIdentity", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.NODE],
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
    api.node.getNodeIdentity.resolves({
      metadata: {
        attnets: [true, false],
        seqNumber: BigInt(3),
      },
      p2pAddresses: ["/ip4/127.0.0.1/tcp/36001"],
      peerId: "16",
      enr: "enr-",
      discoveryAddresses: ["/ip4/127.0.0.1/tcp/36000"],
    });
    const response = await supertest(restApi.server.server)
      .get(getNetworkIdentity.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.p2p_addresses.length).to.equal(1);
  });
});
