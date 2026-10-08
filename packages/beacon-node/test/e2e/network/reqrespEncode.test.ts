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
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, GENESIS_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ReqResp, ResponseOutgoing} from "@lodestar/reqresp";
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
import {DataColumnSidecarsByRange, DataColumnSidecarsByRoot} from "../../../src/network/reqresp/protocols.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../../../src/network/reqresp/types.js";
import {LocalStatusCache} from "../../../src/network/statusCache.js";
import {computeNodeId} from "../../../src/network/subnets/index.js";
import {CustodyConfig} from "../../../src/util/dataColumns.js";
import {DataColumnSidecarsByRootRequestType} from "../../../src/util/types.js";

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

  for (const createProtocol of [DataColumnSidecarsByRange, DataColumnSidecarsByRoot]) {
    for (const {name, schedule, epochs} of [
      {name: "mixed Fulu and Gloas responses", schedule: [], epochs: [6, 7]},
      {
        name: "a future blob-limit increase followed by a decrease",
        schedule: [
          {EPOCH: 8, MAX_BLOBS_PER_BLOCK: 32},
          {EPOCH: 9, MAX_BLOBS_PER_BLOCK: 12},
        ],
        epochs: [8, 9],
      },
    ]) {
      const beaconConfig = createBeaconConfig(
        {
          ...config,
          ALTAIR_FORK_EPOCH: 1,
          BELLATRIX_FORK_EPOCH: 2,
          CAPELLA_FORK_EPOCH: 3,
          DENEB_FORK_EPOCH: 4,
          ELECTRA_FORK_EPOCH: 5,
          FULU_FORK_EPOCH: 6,
          GLOAS_FORK_EPOCH: 7,
          HEZE_FORK_EPOCH: 10,
          BLOB_SCHEDULE: schedule,
        },
        ZERO_HASH
      );
      const protocol = createProtocol(ForkName.gloas, beaconConfig);

      it(`decodes ${name} for ${protocol.method}`, async () => {
        const responses: ResponseOutgoing[] = epochs.map((epoch) => {
          const boundary = beaconConfig.getForkBoundaryAtEpoch(epoch);
          const blobCount = beaconConfig.getMaxBlobsPerBlock(epoch);
          const column = Array.from({length: blobCount}, () => ssz.fulu.Cell.defaultValue());
          const kzgProofs = Array.from({length: blobCount}, () => ssz.deneb.KZGProof.defaultValue());
          let data: Uint8Array;
          if (boundary.fork === ForkName.fulu) {
            const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
            sidecar.column = column;
            sidecar.kzgProofs = kzgProofs;
            sidecar.kzgCommitments = Array.from({length: blobCount}, () => ssz.deneb.KZGCommitment.defaultValue());
            sidecar.signedBlockHeader.message.slot = epoch * SLOTS_PER_EPOCH;
            data = ssz.fulu.DataColumnSidecar.serialize(sidecar);
            expect(data.length).toBeGreaterThan(protocol.responseSizes(ForkName.gloas).maxSize);
          } else {
            const sidecar = ssz.gloas.DataColumnSidecar.defaultValue();
            sidecar.column = column;
            sidecar.kzgProofs = kzgProofs;
            sidecar.slot = epoch * SLOTS_PER_EPOCH;
            data = ssz.gloas.DataColumnSidecar.serialize(sidecar);
          }
          return {data, boundary};
        });
        const request =
          protocol.method === ReqRespMethod.DataColumnSidecarsByRange
            ? ssz.fulu.DataColumnSidecarsByRangeRequest.serialize({
                startSlot: epochs[0] * SLOTS_PER_EPOCH,
                count: (epochs[1] - epochs[0]) * SLOTS_PER_EPOCH + 1,
                columns: [0],
              })
            : DataColumnSidecarsByRootRequestType(beaconConfig).serialize(
                epochs.map((epoch) => ({blockRoot: new Uint8Array(32).fill(epoch), columns: [0]}))
              );
        const {libp2p: server, multiaddr} = await getLibp2p();
        const {libp2p: client} = await getLibp2p();
        const responder = new ReqResp({libp2p: server, logger: testLogger(), metricsRegister: null});
        const requester = new ReqResp({libp2p: client, logger: testLogger(), metricsRegister: null});
        afterEachCallbacks.push(
          () => responder.stop(),
          () => requester.stop()
        );
        await responder.registerProtocol({
          ...protocol,
          handler: async function* (req) {
            expect(toHex(req.data)).toBe(toHex(request));
            yield* responses;
          },
        });
        const {inboundRateLimits: _inboundRateLimits, ...dialProtocol} = protocol;
        requester.registerDialOnlyProtocol(dialProtocol);
        await client.dial(multiaddr);

        const decoded = await Array.fromAsync(
          requester.sendRequest(server.peerId, protocol.method, [protocol.version], protocol.encoding, request)
        );
        expect(decoded.map((response) => ({...response, data: new Uint8Array(response.data)}))).toEqual(
          responses.map(({data, boundary}) => ({data, fork: boundary.fork, protocolVersion: protocol.version}))
        );
      });
    }
  }
});
