import {expect} from "chai";
import supertest from "supertest";

import {getPeers} from "../../../../../src/api/rest/controllers/node";
import {urlJoin} from "../utils";
import {NODE_PREFIX} from "../index.test";

describe("rest - node - getPeers", function () {
  it("should succeed", async function () {
    this.test?.ctx?.api.node.getPeers.withArgs(["connected"], undefined).resolves([
      {
        lastSeenP2pAddress: "/ip4/127.0.0.1/tcp/36000",
        direction: "inbound",
        enr: "enr-",
        peerId: "16",
        state: "connected",
      },
    ]);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getPeers.url))
      .query({state: "connected"})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.length).to.equal(1);
    expect(response.body.data[0].peer_id).to.equal("16");
  });
});
