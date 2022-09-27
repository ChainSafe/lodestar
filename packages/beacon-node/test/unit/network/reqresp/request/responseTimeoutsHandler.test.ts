import {Libp2p} from "libp2p";
import {Stream} from "@libp2p/interface-connection";
import {LodestarError, sleep as _sleep} from "@lodestar/utils";
import {phase0} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {createIBeaconConfig} from "@lodestar/config";
import {RespStatus, timeoutOptions, ZERO_HASH} from "../../../../../src/constants/index.js";
import {PeersData} from "../../../../../src/network/peers/peersData.js";
import {
  IRequestErrorMetadata,
  RequestError,
  RequestErrorCode,
} from "../../../../../src/network/reqresp/request/errors.js";
import {sendRequest} from "../../../../../src/network/reqresp/request/index.js";
import {Encoding, Method, Version} from "../../../../../src/network/reqresp/types.js";
import {expectRejectedWithLodestarError} from "../../../../utils/errors.js";
import {getValidPeerId} from "../../../../utils/peer.js";
import {testLogger} from "../../../../utils/logger.js";
import {sszSnappySignedBeaconBlockPhase0} from "../encodingStrategies/sszSnappy/testData.js";
import {formatProtocolId} from "../../../../../src/network/reqresp/utils/protocolId.js";

/* eslint-disable require-yield */

describe("network / reqresp / request / responseTimeoutsHandler", () => {
  const logger = testLogger();

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());
  async function sleep(ms: number): Promise<void> {
    await _sleep(ms, controller.signal);
  }

  // Generic request params not relevant to timeout tests
  const method = Method.BeaconBlocksByRange;
  const encoding = Encoding.SSZ_SNAPPY;
  const version = Version.V1;
  const requestBody: phase0.BeaconBlocksByRangeRequest = {startSlot: 0, count: 9, step: 1};
  const maxResponses = requestBody.count; // Random high number
  const responseChunk = Buffer.concat([
    Buffer.from([RespStatus.SUCCESS]),
    ...sszSnappySignedBeaconBlockPhase0.chunks.map((chunk) => chunk.subarray()),
  ]);
  const protocol = formatProtocolId(method, version, encoding);
  const peerId = getValidPeerId();
  const metadata: IRequestErrorMetadata = {method, encoding, peer: peerId.toString()};

  /* eslint-disable @typescript-eslint/naming-convention */
  const testCases: {
    id: string;
    opts?: Partial<typeof timeoutOptions>;
    source: () => AsyncGenerator<Uint8Array>;
    error?: LodestarError<any>;
  }[] = [
    {
      id: "yield values without errors",
      source: async function* () {
        yield responseChunk.subarray(0, 1);
        await sleep(0);
        yield responseChunk.subarray(1);
      },
    },
    {
      id: "trigger a TTFB_TIMEOUT",
      opts: {TTFB_TIMEOUT: 0},
      source: async function* () {
        await sleep(30); // Pause for too long before first byte
        yield responseChunk;
      },
      error: new RequestError({code: RequestErrorCode.TTFB_TIMEOUT}, metadata),
    },
    {
      id: "trigger a RESP_TIMEOUT",
      opts: {RESP_TIMEOUT: 0},
      source: async function* () {
        yield responseChunk.subarray(0, 1);
        await sleep(30); // Pause for too long after first byte
        yield responseChunk.subarray(1);
      },
      error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}, metadata),
    },
    {
      // Upstream "abortable-iterator" never throws with an infinite sleep.
      id: "Infinite sleep on first byte",
      opts: {TTFB_TIMEOUT: 1, RESP_TIMEOUT: 1},
      source: async function* () {
        await sleep(100000);
      },
      error: new RequestError({code: RequestErrorCode.TTFB_TIMEOUT}, metadata),
    },
    {
      id: "Infinite sleep on second chunk",
      opts: {TTFB_TIMEOUT: 1, RESP_TIMEOUT: 1},
      source: async function* () {
        yield responseChunk;
        await sleep(100000);
      },
      error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}, metadata),
    },
  ];

  /* eslint-disable @typescript-eslint/no-empty-function */

  for (const {id, opts, source, error} of testCases) {
    it(id, async () => {
      const libp2p = ({
        async dialProtocol() {
          return ({
            async sink(): Promise<void> {},
            source: source(),
            close() {},
            closeRead() {},
            closeWrite() {},
            abort() {},
            stat: {direction: "outbound", timeline: {open: Date.now()}, protocol},
          } as Partial<Stream>) as Stream;
        },
      } as Partial<Libp2p>) as Libp2p;

      const testPromise = sendRequest(
        {
          logger,
          forkDigestContext: createIBeaconConfig(config, ZERO_HASH),
          libp2p,
          peersData: new PeersData(),
        },
        peerId,
        method,
        encoding,
        [version],
        requestBody,
        maxResponses,
        undefined,
        opts
      );

      if (error) {
        await expectRejectedWithLodestarError(testPromise, error);
      } else {
        await testPromise;
      }
    });
  }
});
