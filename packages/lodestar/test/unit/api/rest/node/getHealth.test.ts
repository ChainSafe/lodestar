import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import sinon from "sinon";
import supertest from "supertest";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {ApiNamespace} from "../../../../../src/api";
import {RestApi} from "../../../../../src/api/rest";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {getHealth} from "../../../../../src/api/rest/controllers/node";

describe("rest - node - getHealth", function () {

  let api: RestApi;
  let nodeApiStub: StubbedNodeApi;

  beforeEach(async function () {
    nodeApiStub = new StubbedNodeApi();
    api = new RestApi({
      api: [ApiNamespace.NODE],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      config,
      logger: sinon.createStubInstance(WinstonLogger),
      validator: sinon.createStubInstance(ValidatorApi),
      beacon: sinon.createStubInstance(BeaconApi),
      node: nodeApiStub
    });
    await api.start();
  });

  afterEach(async function() {
    await api.stop();
  });

  it("ready", async function () {
    nodeApiStub.getNodeStatus.resolves("ready");
    await supertest(api.server.server)
      .get(getHealth.url)
      .expect(200);
  });

  it("syncing", async function () {
    nodeApiStub.getNodeStatus.resolves("syncing");
    await supertest(api.server.server)
      .get(getHealth.url)
      .expect(206);
  });

  it("error", async function () {
    nodeApiStub.getNodeStatus.resolves("error");
    await supertest(api.server.server)
      .get(getHealth.url)
      .expect(503);
  });

});
