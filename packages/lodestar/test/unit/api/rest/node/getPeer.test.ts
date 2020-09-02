import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import supertest from "supertest";
import {expect} from "chai";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {ApiNamespace} from "../../../../../src/api";
import {RestApi} from "../../../../../src/api/rest";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {getPeer} from "../../../../../src/api/rest/controllers/node";
import {silentLogger} from "../../../../utils/logger";

describe("rest - node - getPeer", function () {
  let api: RestApi;
  let nodeApiStub: StubbedNodeApi;

  beforeEach(async function () {
    nodeApiStub = new StubbedNodeApi();
    api = new RestApi(
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
        validator: sinon.createStubInstance(ValidatorApi),
        beacon: sinon.createStubInstance(BeaconApi),
        node: nodeApiStub,
      }
    );
    await api.start();
  });

  afterEach(async function () {
    await api.stop();
  });

  it("should succeed", async function () {
    nodeApiStub.getPeer.resolves({
      address: "/ip4/127.0.0.1/tcp/36000",
      direction: "inbound",
      enr: "enr-",
      peerId: "16",
      state: "connected",
    });
    const response = await supertest(api.server.server)
      .get(getPeer.url.replace(":peerId", "16"))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.peer_id).to.equal("16");
  });

  it("peer not found", async function () {
    nodeApiStub.getPeer.resolves(null);
    await supertest(api.server.server).get(getPeer.url.replace(":peerId", "16")).expect(404);
  });
});
