import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import sinon from "sinon";
import supertest from "supertest";
import {expect} from "chai";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {getNetworkIdentity} from "../../../../../src/api/rest/controllers/node/getNetworkIdentity";
import {ApiNamespace} from "../../../../../src/api";
import {RestApi} from "../../../../../src/api/rest";
import {ValidatorApi} from "../../../../../src/api/impl/validator";

describe("rest - node - getNetworkIdentity", function () {

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

  it("should succeed", async function () {
    nodeApiStub.getNodeIdentity.resolves({
      metadata: {
        attnets: [true, false],
        seqNumber: BigInt(3)
      },
      p2pAddresses: ["/ip4/127.0.0.1/tcp/36001"],
      peerId: "16",
      enr: "enr-",
      discoveryAddresses: ["/ip4/127.0.0.1/tcp/36000"]
    });
    const response = await supertest(api.server.server)
      .get(getNetworkIdentity.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.p2p_addresses.length).to.equal(1);
  });

});
