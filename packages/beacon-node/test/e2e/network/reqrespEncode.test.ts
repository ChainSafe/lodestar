import {describe, it, afterEach, expect} from "vitest";
import all from "it-all";
import {Libp2p, createLibp2p} from "libp2p";
import {tcp} from "@libp2p/tcp";
import {mplex} from "@libp2p/mplex";
import {Multiaddr, multiaddr} from "@multiformats/multiaddr";
import {noise} from "@chainsafe/libp2p-noise";
import {ssz} from "@lodestar/types";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {fromHex, sleep, toHex} from "@lodestar/utils";
import {
  NetworkEventBus,
  PeerRpcScoreStore,
  ReqRespBeaconNode,
  ReqRespBeaconNodeModules,
} from "../../../src/network/index.js";
import {PeersData} from "../../../src/network/peers/peersData.js";
import {ZERO_HASH} from "../../../src/constants/constants.js";
import {MetadataController} from "../../../src/network/metadata.js";
import {testLogger} from "../../utils/logger.js";
import {GetReqRespHandlerFn} from "../../../src/network/reqresp/types.js";
import {LocalStatusCache} from "../../../src/network/statusCache.js";

/* eslint-disable require-yield */

describe("reqresp encoder", () => {
  let port = 60000;

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function getLibp2p() {
    const listen = `/ip4/127.0.0.1/tcp/${port++}`;
    const libp2p = await createLibp2p({
      transports: [tcp()],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
      addresses: {
        listen: [listen],
      },
    });
    afterEachCallbacks.push(() => libp2p.stop());
    return {libp2p, multiaddr: multiaddr(`${listen}/p2p/${libp2p.peerId.toString()}`)};
  }

  async function getReqResp(getHandler?: GetReqRespHandlerFn) {
    const {libp2p, multiaddr} = await getLibp2p();

    const getHandlerNoop: GetReqRespHandlerFn = () =>
      async function* <T>(): AsyncIterable<T> {
        throw Error("not implemented");
      };

    const config = createBeaconConfig({}, ZERO_HASH);
    const modules: ReqRespBeaconNodeModules = {
      libp2p,
      peersData: new PeersData(),
      logger: testLogger(),
      config,
      metrics: null,
      getHandler: getHandler ?? getHandlerNoop,
      metadata: new MetadataController({}, {config, onSetValue: () => null}),
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
    if (requestChunks) {
      await stream.sink(requestChunks.map(fromHex));
    }

    const chunks = await all(stream.source);
    const join = (c: string[]): string => c.join("").replace(/0x/g, "");
    const chunksHex = chunks.map((chunk) => toHex(chunk.slice(0, chunk.byteLength)));
    expect(join(chunksHex)).toEqual(join(expectedChunks));
  }

  it("assert correct handler switch between metadata v2 and v1", async () => {
    const {multiaddr: serverMultiaddr, reqresp} = await getReqResp();
    reqresp.registerProtocolsAtFork(ForkName.phase0);
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

    await dialProtocol({
      dialer,
      toMultiaddr: serverMultiaddr,
      protocol: "/eth2/beacon_chain/req/metadata/2/ssz_snappy",
      expectedChunks: ["0x00", "0x11", "0xff060000734e615070590013000080f865931100000d0120010100000000000002"],
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
            fork: ForkName.phase0, // Aware that phase0 does not makes sense here, but it's just to pick a fork digest
          };
        }
    );
    reqresp.registerProtocolsAtFork(ForkName.altair);
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
