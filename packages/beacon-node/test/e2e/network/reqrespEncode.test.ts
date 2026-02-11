import {generateKeyPair} from "@libp2p/crypto/keys";
import type {PrivateKey} from "@libp2p/interface";
import {mplex} from "@libp2p/mplex";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {tcp} from "@libp2p/tcp";
import {byteStream} from "@libp2p/utils";
import type {Multiaddr} from "@multiformats/multiaddr";
import type {Libp2p} from "libp2p";
import {createLibp2p} from "libp2p";
import {afterEach, describe, expect, it} from "vitest";
import {noise} from "@chainsafe/libp2p-noise";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ForkName, GENESIS_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex, sleep, toHex} from "@lodestar/utils";
import {ZERO_HASH} from "../../../src/constants/constants.js";
import {
  NetworkEventBus,
  PeerRpcScoreStore,
  ReqRespBeaconNode,
  ReqRespBeaconNodeModules,
} from "../../../src/network/index.js";
import {MetadataController} from "../../../src/network/metadata.js";
import {NetworkConfig} from "../../../src/network/networkConfig.js";
import {PeersData} from "../../../src/network/peers/peersData.js";
import {GetReqRespHandlerFn} from "../../../src/network/reqresp/types.js";
import {LocalStatusCache} from "../../../src/network/statusCache.js";
import {computeNodeId} from "../../../src/network/subnets/index.js";
import {CustodyConfig} from "../../../src/util/dataColumns.js";
import {testLogger} from "../../utils/logger.js";

describe("reqresp encoder", () => {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function getLibp2p(privateKey?: PrivateKey) {
    const libp2p = await createLibp2p({
      privateKey,
      transports: [tcp()],
      // Increase disconnectThreshold to prevent mplex from closing the connection
      // when it receives messages for already-closed streams
      streamMuxers: [mplex({disconnectThreshold: Infinity})],
      connectionEncrypters: [noise()],
      addresses: {
        listen: ["/ip4/127.0.0.1/tcp/0"],
      },
    });
    afterEachCallbacks.push(() => libp2p.stop());
    const listenMultiaddr = libp2p.getMultiaddrs()[0];
    return {libp2p, multiaddr: listenMultiaddr};
  }

  async function getReqResp(getHandler?: GetReqRespHandlerFn) {
    const privateKey = await generateKeyPair("secp256k1");
    const {libp2p, multiaddr} = await getLibp2p(privateKey);

    const getHandlerNoop: GetReqRespHandlerFn = () =>
      // biome-ignore lint/correctness/useYield: No need for yield in test context
      async function* <T>(): AsyncIterable<T> {
        throw Error("not implemented");
      };

    const config = createBeaconConfig({}, ZERO_HASH);
    const peerId = peerIdFromPrivateKey(privateKey);
    const nodeId = computeNodeId(peerId);
    const networkConfig: NetworkConfig = {
      nodeId,
      config,
      custodyConfig: new CustodyConfig({
        nodeId,
        config,
      }),
    };
    const logger = testLogger();
    const modules: ReqRespBeaconNodeModules = {
      libp2p,
      peersData: new PeersData(),
      logger,
      config,
      metrics: null,
      getHandler: getHandler ?? getHandlerNoop,
      metadata: new MetadataController({}, {networkConfig, logger, onSetValue: () => null}),
      peerRpcScores: new PeerRpcScoreStore(),
      events: new NetworkEventBus(),
      statusCache: new LocalStatusCache(ssz.phase0.Status.defaultValue()),
    };

    return {libp2p, multiaddr, reqresp: new ReqRespBeaconNode(modules)};
  }

  async function dialProtocol({
    dialer,
    toMultiaddr,
    protocol,
    requestChunks,
    expectedChunks,
  }: {
    dialer: Libp2p;
    toMultiaddr: Multiaddr;
    protocol: string;
    requestChunks?: string[];
    expectedChunks: string[];
  }) {
    const stream = await dialer.dialProtocol(toMultiaddr, protocol);
    // Use byteStream to read response - it attaches event listeners immediately,
    // avoiding race conditions with the async iterator where remoteCloseWrite
    // events can be lost if the server responds in the same macrotask
    const bytes = byteStream(stream);

    if (requestChunks) {
      for (const chunk of requestChunks) {
        await bytes.write(fromHex(chunk));
      }
    }

    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await bytes.read({signal: AbortSignal.timeout(2000)});
      if (chunk === null) break;
      chunks.push(chunk.subarray());
    }

    // Abort for fast cleanup instead of graceful close which can be slow
    stream.abort(new Error("test done"));

    const join = (c: string[]): string => c.join("").replace(/0x/g, "");
    const chunksHex = chunks.map((chunk) => toHex(chunk));
    expect(join(chunksHex)).toEqual(join(expectedChunks));
  }

  it("assert correct handler for metadata v3", async () => {
    const {multiaddr: serverMultiaddr, reqresp} = await getReqResp();
    reqresp.registerProtocolsAtBoundary({fork: ForkName.phase0, epoch: GENESIS_EPOCH});
    await sleep(0); // Sleep to resolve register handler promises

    reqresp["metadataController"].attnets.set(0, true);
    reqresp["metadataController"].attnets.set(8, true);
    reqresp["metadataController"].syncnets.set(1, true);

    const {libp2p: dialer} = await getLibp2p();
    await dialProtocol({
      dialer,
      toMultiaddr: serverMultiaddr,
      protocol: "/eth2/beacon_chain/req/metadata/3/ssz_snappy",
      expectedChunks: [
        "0x00",
        "0x19",
        "0xff060000734e61507059001b000082e4dd0e1900000d01400101000000000000020400000000000000",
      ],
    });
  });

  it("assert correct handler for metadata v1", async () => {
    const {multiaddr: serverMultiaddr, reqresp} = await getReqResp();
    reqresp.registerProtocolsAtBoundary({fork: ForkName.phase0, epoch: GENESIS_EPOCH});
    await sleep(0); // Sleep to resolve register handler promises

    reqresp["metadataController"].attnets.set(0, true);
    reqresp["metadataController"].attnets.set(8, true);
    reqresp["metadataController"].syncnets.set(1, true);

    const {libp2p: dialer} = await getLibp2p();
    await dialProtocol({
      dialer,
      toMultiaddr: serverMultiaddr,
      protocol: "/eth2/beacon_chain/req/metadata/1/ssz_snappy",
      expectedChunks: ["0x00", "0x10", "0xff060000734e615070590114000077b18d3800000000000000000101000000000000"],
    });
  });

  it("assert correct encoding of protocol with context bytes", async () => {
    const {multiaddr: serverMultiaddr, reqresp} = await getReqResp(
      () =>
        async function* () {
          yield {
            data: ssz.altair.LightClientOptimisticUpdate.serialize(
              ssz.altair.LightClientOptimisticUpdate.defaultValue()
            ),
            boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH}, // Aware that phase0 does not makes sense here, but it's just to pick a fork digest
          };
        }
    );
    reqresp.registerProtocolsAtBoundary({fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH});
    await sleep(0); // Sleep to resolve register handler promises

    const {libp2p: dialer} = await getLibp2p();
    await dialProtocol({
      dialer,
      toMultiaddr: serverMultiaddr,
      protocol: "/eth2/beacon_chain/req/light_client_optimistic_update/1/ssz_snappy",
      expectedChunks: [
        "0x00",
        "0x18ae4ccb",
        "0xdc01",
        "0xff060000734e61507059001400008b1d43afdc010000fe0100fe0100fe01006a0100",
      ],
    });
  });
});
