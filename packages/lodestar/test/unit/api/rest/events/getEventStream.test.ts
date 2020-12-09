import EventSource from "eventsource";
import {URL} from "url";
import {BeaconEvent, BeaconEventType} from "../../../../../src/api/impl/events";
import {RestApi} from "../../../../../src/api/rest";
import {StubbedApi} from "../../../../utils/stub/api";
import sinon from "sinon";
import {ApiNamespace} from "../../../../../src/api/impl";
import {config} from "@chainsafe/lodestar-config/minimal";
import {silentLogger} from "../../../../utils/logger";
import pushable from "it-pushable/index";
import {generateAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {AddressInfo} from "net";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";

describe("rest - events - getEventStream", function () {
  let restApi: RestApi, api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi(sinon);
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.EVENTS],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        config,
        logger: silentLogger,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should subscribe to topics", async function () {
    const source = pushable<BeaconEvent>();
    // @ts-ignore
    source.stop = () => null;
    api.events.getEventStream.returns((source as unknown) as LodestarEventIterator<BeaconEvent>);
    const eventSource = new EventSource(getEventStreamUrl([BeaconEventType.BLOCK, BeaconEventType.ATTESTATION]));
    const blockEventPromise = new Promise((resolve) => {
      eventSource.addEventListener(BeaconEventType.BLOCK, resolve);
    });
    const attestationEventPromise = new Promise((resolve) => {
      eventSource.addEventListener(BeaconEventType.ATTESTATION, resolve);
    });
    source.push({
      type: BeaconEventType.BLOCK,
      message: {
        slot: 1,
        block: Buffer.alloc(32, 0),
      },
    });
    source.push({
      type: BeaconEventType.ATTESTATION,
      message: generateAttestation(),
    });
    const blockEvent = await blockEventPromise;
    const attestationEvent = await attestationEventPromise;
    expect(blockEvent).to.not.be.null;
    expect(attestationEvent).to.not.be.null;
    eventSource.close();
  });

  function getEventStreamUrl(topics: BeaconEventType[]): string {
    const addressInfo = restApi.server.server.address() as AddressInfo;
    return new URL(
      "/eth/v1/events?" + topics.map((t) => "topics=" + t).join("&"),
      "http://" + addressInfo.address + ":" + addressInfo.port
    ).toString();
  }
});
