import EventSource from "eventsource";
import {URL} from "url";
import {BeaconEvent, BeaconEventType} from "../../../../../src/api/impl/events";
import {RestApi} from "../../../../../src/api/rest";
import pushable from "it-pushable/index";
import {generateAttestation} from "../../../../utils/attestation";
import {expect} from "chai";
import {AddressInfo} from "net";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {setupRestApiTestServer} from "../index.test";
import {SinonStubbedInstance} from "sinon";
import {EventsApi} from "../../../../../src/api";

describe("rest - events - getEventStream", function () {
  it("should subscribe to topics", async function () {
    const restApi = await setupRestApiTestServer();
    const eventsApiStub = restApi.server.api.events as SinonStubbedInstance<EventsApi>;

    const source = pushable<BeaconEvent>();
    // @ts-ignore
    source.stop = () => null;
    eventsApiStub.getEventStream.returns((source as unknown) as LodestarEventIterator<BeaconEvent>);
    const eventSource = new EventSource(
      getEventStreamUrl([BeaconEventType.BLOCK, BeaconEventType.ATTESTATION], restApi)
    );
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

  function getEventStreamUrl(topics: BeaconEventType[], restApi: RestApi): string {
    const addressInfo = restApi.server.server.address() as AddressInfo;
    return new URL(
      "/eth/v1/events?" + topics.map((t) => "topics=" + t).join("&"),
      "http://" + addressInfo.address + ":" + addressInfo.port
    ).toString();
  }
});
