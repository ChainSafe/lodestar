import {describe} from "mocha";
import {RestApi} from "../../../../../src/api/rest";
import {ApiNamespace} from "../../../../../src/api";
import sinon, {SinonStubbedInstance} from "sinon";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import supertest from "supertest";
import {expect} from "chai";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import pushable, {Pushable} from "it-pushable";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {generateEmptySignedBlock} from "../../../../utils/block";
import EventSource from "eventsource";
import {LodestarEventIterator} from "../../../../../src/util/events";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";

describe("Test beacon rest api", function () {
  this.timeout(10000);

  let restApi: any, beaconApi: SinonStubbedInstance<BeaconApi>, validatorApi: SinonStubbedInstance<ValidatorApi>;


  beforeEach(async function () {
    validatorApi = sinon.createStubInstance(ValidatorApi);
    beaconApi = sinon.createStubInstance(BeaconApi);
    restApi = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      logger: sinon.createStubInstance(WinstonLogger),
      beacon: beaconApi,
      validator: validatorApi,
      node: new StubbedNodeApi(),
      config
    });
    return await restApi.start();
  });

  afterEach(async function () {
    return await restApi.stop();
  });

  it("should get block stream",  function (done) {
    const server = restApi.server.server.address();
    const source
        = pushable<SignedBeaconBlock>() as LodestarEventIterator<SignedBeaconBlock>&Pushable<SignedBeaconBlock>;
    source.stop = sinon.stub();
    beaconApi.getBlockStream.returns(source);
    const eventSource = new EventSource(
      `http://${server.address}:${server.port}/lodestar/blocks/stream`,
      {https: {rejectUnauthorized: false}}
    );
    eventSource.addEventListener("open", function () {
      source.push(generateEmptySignedBlock());
      source.push(generateEmptySignedBlock());
    });
    let count = 0;
    eventSource.addEventListener("message", function () {
      count++;
      if(count === 2) {
        source.end();
        eventSource.close();
        done();
      }
    });
  });

});
