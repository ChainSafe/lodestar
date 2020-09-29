import {AddressInfo} from "net";
import EventSource from "eventsource";
import pushable, {Pushable} from "it-pushable";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {LodestarEventIterator} from "../../../../../src/util/events";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {StubbedApi} from "../../../../utils/stub/api";
import {silentLogger} from "../../../../utils/logger";

export const BEACON_PREFIX = "/eth/v1/beacon";

describe("Test beacon rest api", function () {
  this.timeout(10000);

  let restApi: RestApi, api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi(sinon);
    restApi = await RestApi.init({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0,
    }, {
      config,
      logger: silentLogger,
      api,
    });
  });

  afterEach(async function () {
    await restApi.close();
    sinon.restore();
  });

  it("should get block stream", function (done) {
    const server = restApi.server.server.address() as AddressInfo;
    const source = pushable<SignedBeaconBlock>() as LodestarEventIterator<SignedBeaconBlock> &
      Pushable<SignedBeaconBlock>;
    source.stop = sinon.stub();
    api.beacon.getBlockStream.returns(source);
    const eventSource = new EventSource(`http://${server.address}:${server.port}/lodestar/blocks/stream`, {
      https: {rejectUnauthorized: false},
    });
    eventSource.addEventListener("open", function () {
      source.push(generateEmptySignedBlock());
      source.push(generateEmptySignedBlock());
    });
    let count = 0;
    eventSource.addEventListener("message", function () {
      count++;
      if (count === 2) {
        source.end();
        eventSource.close();
        done();
      }
    });
  });
});
