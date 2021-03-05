import {expect} from "chai";
import supertest from "supertest";

import {getNetworkIdentity} from "../../../../../src/api/rest/controllers/node/getNetworkIdentity";
import {urlJoin} from "../utils";
import {NODE_PREFIX, api, restApi} from "./index.test";

describe("rest - node - getNetworkIdentity", function () {
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
      .get(urlJoin(NODE_PREFIX, getNetworkIdentity.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.p2p_addresses.length).to.equal(1);
  });
});
