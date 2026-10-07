import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {fetch} from "@lodestar/utils";
import {GossipType} from "../../../src/network/gossip/interface.js";
import {ReqRespMethod} from "../../../src/network/reqresp/types.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getNetworkForTest} from "../../utils/networkWithMockDb.js";

type Breakdown = {
  protocol: string;
  topic: string;
  message_kind: string;
  bytes_in: number;
  bytes_out: number;
  msg_count: number;
};
type Detail = {summary: {meta: {proposer_index?: number}}; breakdown: Breakdown[]};

describe.skipIf(!process.env.XRAY_BINARY)("Xray collector interoperability", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
  });

  for (const useWorker of [false, true]) {
    for (const transport of ["tcp", "quic"] as const) {
      it(`captures gossip and repeated req/resp over ${transport}, worker=${useWorker}`, async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "lodestar-xray-"));
        cleanup.push(() => rm(dir, {recursive: true, force: true}));
        const address = path.join(dir, "ingest.sock");
        const child = spawn(process.env.XRAY_BINARY ?? "", [
          "--listen=127.0.0.1:0",
          `--ingest=${address}`,
          `--data-dir=${dir}`,
        ]);
        let logs = "";
        child.stderr.on("data", (chunk: Buffer) => {
          logs += chunk.toString();
        });
        const exited = once(child, "exit");
        cleanup.push(async () => {
          child.kill("SIGTERM");
          await exited;
        });
        await expect.poll(() => logs, {timeout: 10_000}).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
        const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        async function get<T>(route: string): Promise<T> {
          const response = await fetch(`${url}${route}`);
          expect(response.ok).toBe(true);
          return response.json() as Promise<T>;
        }
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.proposerIndex = 7;
        let received = 0;
        let requests = 0;
        const opts = {
          useWorker,
          tcp: transport === "tcp",
          quic: transport === "quic",
          localMultiaddrs: [transport === "tcp" ? "/ip4/127.0.0.1/tcp/0" : "/ip4/127.0.0.1/udp/0/quic-v1"],
          xrayAddress: address,
          xrayWaitForAttach: true,
          version: "xray-interop-test",
        };
        const [a, closeA] = await getNetworkForTest("xray-a", config, {
          opts,
          gossipHandlersPartial: {
            [GossipType.beacon_block]: async () => {
              received++;
            },
          },
        });
        cleanup.push(closeA);
        const [b, closeB] = await getNetworkForTest("xray-b", config, {
          opts,
          gossipHandlersPartial: {
            [GossipType.beacon_block]: async () => {
              received++;
            },
          },
          getReqRespHandler: (method) =>
            async function* () {
              if (method === ReqRespMethod.BeaconBlocksByRange) {
                requests++;
                yield {data: ssz.phase0.SignedBeaconBlock.serialize(block), boundary: config.getForkBoundaryAtEpoch(0)};
              }
            },
        });
        cleanup.push(closeB);
        await Promise.all([onPeerConnect(a), onPeerConnect(b), connect(a, b)]);
        await a.subscribeGossipCoreTopics();
        await b.subscribeGossipCoreTopics();
        await expect
          .poll(
            async () =>
              Object.entries(await a.dumpMeshPeers()).some(
                ([topic, peers]) => topic.includes("beacon_block") && peers.length > 0
              ),
            {timeout: 10_000}
          )
          .toBe(true);
        await a.publishBeaconBlock(block);
        await expect.poll(() => received).toBe(1);
        for (let i = 0; i < 2; i++) {
          const responses = await a.sendBeaconBlocksByRange(b.peerId.toString(), {startSlot: 0, count: 1, step: 1});
          expect(responses).toHaveLength(1);
        }
        expect(requests).toBe(2);
        const sources = await get<{sources: {source_id: string; client_name: string; connected: boolean}[]}>(
          "/api/sources"
        );
        expect(sources.sources).toHaveLength(2);
        for (const source of sources.sources) {
          expect(source.client_name).toBe("lodestar/xray-interop-test");
          expect(source.connected).toBe(true);
        }
        async function details(source: string): Promise<Detail[]> {
          const {slots} = await get<{slots: {slot: number}[]}>(`/api/slots?source=${source}`);
          return Promise.all(slots.map(({slot}) => get<Detail>(`/api/slots/${slot}?source=${source}`)));
        }
        await expect
          .poll(async () =>
            (await details(b.peerId.toString()))
              .flatMap((d) => d.breakdown)
              .some((row) => row.topic === "beacon_block" && row.message_kind === "PUBLISH" && row.bytes_in > 0)
          )
          .toBe(true);
        for (const peer of [a.peerId.toString(), b.peerId.toString()]) {
          const rows = (await details(peer)).flatMap((d) => d.breakdown);
          expect(
            rows.some((row) => row.protocol.includes("beacon_blocks_by_range") && row.bytes_in + row.bytes_out > 0)
          ).toBe(true);
          expect(
            rows.some((row) => row.message_kind === "decode_error" || row.message_kind === "capture_incomplete")
          ).toBe(false);
          const {peers} = await get<{peers: {connections: {transport: string}[]}[]}>(`/api/peers?source=${peer}`);
          expect(
            peers.flatMap((p) => p.connections).some((c) => c.transport === (transport === "tcp" ? "tcp" : "quic-v1"))
          ).toBe(true);
        }
        const incoming = await details(b.peerId.toString());
        expect(incoming.some((d) => d.summary.meta.proposer_index === 7)).toBe(true);
        await closeA();
        await closeB();
        cleanup.splice(cleanup.indexOf(closeA), 1);
        cleanup.splice(cleanup.indexOf(closeB), 1);
        await expect
          .poll(async () => (await get<typeof sources>("/api/sources")).sources.every((s) => !s.connected))
          .toBe(true);
      }, 60_000);
    }
  }
});
