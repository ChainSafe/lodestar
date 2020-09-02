import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import supertest from "supertest";
import {expect} from "chai";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {ApiNamespace} from "../../../../../src/api";
import {RestApi} from "../../../../../src/api/rest";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {getSyncingStatus} from "../../../../../src/api/rest/controllers/node";
import {silentLogger} from "../../../../utils/logger";

describe("rest - node - getSyncingStatus", function () {
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
    nodeApiStub.getSyncingStatus.resolves({
      headSlot: BigInt(3),
      syncDistance: BigInt(2),
    });
    const response = await supertest(api.server.server)
      .get(getSyncingStatus.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.head_slot).to.equal("3");
    expect(response.body.data.sync_distance).to.equal("2");
  });
});
