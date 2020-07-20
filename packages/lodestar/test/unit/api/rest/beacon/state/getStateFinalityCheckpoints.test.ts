import {RestApi} from "../../../../../../src/api/rest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ValidatorApi} from "../../../../../../src/api/impl/validator";
import sinon from "sinon";
import {ApiNamespace} from "../../../../../../src/api";
import {StubbedBeaconApi} from "../../../../../utils/stub/beaconApi";
import supertest from "supertest";
import {expect} from "chai";
import {getBlock} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {StubbedNodeApi} from "../../../../../utils/stub/nodeApi";
import {generateState} from "../../../../../utils/state";
import {getStateFinalityCheckpoints} from "../../../../../../src/api/rest/controllers/beacon/state";

describe("rest - beacon - getStateFinalityCheckpoints", function () {

  let api: RestApi;
  let beaconApiStub: StubbedBeaconApi;

  beforeEach(async function () {
    beaconApiStub = new StubbedBeaconApi();
    api = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      config,
      logger: sinon.createStubInstance(WinstonLogger),
      validator: sinon.createStubInstance(ValidatorApi),
      node: new StubbedNodeApi(),
      beacon: beaconApiStub
    });
    await api.start();
  });

  afterEach(async function() {
    await api.stop();
  });

  it("should succeed", async function () {
    beaconApiStub.state.getState.withArgs("head").resolves(generateState());
    const response = await supertest(api.server.server)
      .get(getStateFinalityCheckpoints.url.replace(":stateId", "head"))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.finalized).to.not.be.undefined;
  });

  it("should not found state", async function () {
    beaconApiStub.state.getState.withArgs("4").resolves(null);
    await supertest(api.server.server)
      .get(getBlock.url.replace(":stateId", "4"))
      .expect(404);
  });

});
