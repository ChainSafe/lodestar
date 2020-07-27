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
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {StubbedNodeApi} from "../../../../../utils/stub/nodeApi";
import {generateAttestation} from "../../../../../utils/attestation";
import {getPoolAttestations} from "../../../../../../src/api/rest/controllers/beacon/pool";

describe("rest - beacon - getPoolAttestations", function () {

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
    beaconApiStub.pool.getAttestations.withArgs({committeeIndex: 1, slot: 1}).resolves([
      generateAttestation()
    ]);
    const response = await supertest(api.server.server)
      .get(getPoolAttestations.url)
    // eslint-disable-next-line @typescript-eslint/camelcase
      .query({slot: "1", committee_index: "1"})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });


});
