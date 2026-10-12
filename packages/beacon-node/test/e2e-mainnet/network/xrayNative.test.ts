import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect, test, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {fetch} from "@lodestar/utils";
import {NativeNetworkCore} from "../../../src/network/core/native/nativeNetworkCore.js";
import {nativeNetworkFixture} from "../../utils/nativeNetwork.js";
import {nativeNetworkProcess} from "../../utils/nativeNetworkProcess.js";

type Row = {protocol: string; topic: string; message_kind: string; bytes_in: number; bytes_out: number};

test.skipIf(!process.env.XRAY_BINARY)(
  "Xray decodes native gossip and repeated QUIC requests",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lodestar-native-xray-"));
    const address = join(directory, "ingest.sock");
    const collector = spawn(process.env.XRAY_BINARY ?? "", [
      "--listen=127.0.0.1:0",
      `--ingest=${address}`,
      `--data-dir=${directory}`,
      `--genesis-unix=${Math.floor(Date.now() / 1000) - 12}`,
    ]);
    let logs = "";
    collector.stderr.on("data", (bytes: Buffer) => {
      logs += bytes.toString();
    });
    const exited = once(collector, "exit");
    const initialize = NativeNetworkCore.init;
    const spy = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) =>
      initialize({
        ...modules,
        opts: {...modules.opts, xrayAddress: address, xrayWaitForAttach: true},
      })
    );
    let local: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
    let remote: Awaited<ReturnType<typeof nativeNetworkProcess>> | undefined;
    try {
      await expect.poll(() => logs, {timeout: 10_000}).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
      const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      async function get<T>(route: string): Promise<T> {
        const response = await fetch(`${url}${route}`);
        expect(response.ok).toBe(true);
        return response.json() as Promise<T>;
      }
      const config = createBeaconConfig(
        {
          ALTAIR_FORK_EPOCH: 0,
          BELLATRIX_FORK_EPOCH: 0,
          CAPELLA_FORK_EPOCH: 0,
          DENEB_FORK_EPOCH: 0,
          ELECTRA_FORK_EPOCH: 0,
          FULU_FORK_EPOCH: 0,
          GLOAS_FORK_EPOCH: Infinity,
          BLOB_SCHEDULE: [],
        },
        new Uint8Array(32)
      );
      local = await nativeNetworkFixture(config);
      remote = await nativeNetworkProcess(config, "libp2p");
      const identity = await remote.network.getNetworkIdentity();
      const network = local.network;
      await network.connectToPeer(identity.peerId, identity.p2pAddresses);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.proposerIndex = 7;
      await remote.db.blockArchive.put(0, block);
      for (let i = 0; i < 2; i++) {
        const blocks = await network.sendBeaconBlocksByRoot(identity.peerId, [
          ssz.fulu.BeaconBlock.hashTreeRoot(block.message),
        ]);
        expect(blocks).toHaveLength(1);
      }
      await Promise.all([network.subscribeGossipCoreTopics(), remote.network.subscribeGossipCoreTopics()]);
      await expect
        .poll(
          async () =>
            Object.entries(await network.dumpMeshPeers()).some(
              ([topic, peers]) => topic.includes("beacon_block") && peers.length > 0
            ),
          {timeout: 10_000}
        )
        .toBe(true);
      await network.publishBeaconBlock(block);
      await remote.network.publishProposerSlashing(ssz.phase0.ProposerSlashing.defaultValue());
      const source = network.peerId.toString();
      async function rows(): Promise<Row[]> {
        const {slots} = await get<{slots: {slot: number}[]}>(`/api/slots?source=${source}`);
        return (
          await Promise.all(slots.map(({slot}) => get<{breakdown: Row[]}>(`/api/slots/${slot}?source=${source}`)))
        ).flatMap((detail) => detail.breakdown);
      }
      await expect
        .poll(async () =>
          (await rows()).some(
            (row) => row.topic === "beacon_block" && row.message_kind === "PUBLISH" && row.bytes_out > 0
          )
        )
        .toBe(true);
      await expect
        .poll(async () =>
          (await rows()).some(
            (row) => row.topic === "proposer_slashing" && row.message_kind === "PUBLISH" && row.bytes_in > 0
          )
        )
        .toBe(true);
      const captured = await rows();
      expect(
        captured.some((row) => row.protocol.includes("beacon_blocks_by_root") && row.bytes_in > 0 && row.bytes_out > 0)
      ).toBe(true);
      expect(captured.some((row) => ["decode_error", "capture_incomplete"].includes(row.message_kind))).toBe(false);
      expect(await network.scrapeMetrics()).toContain("lodestar_xray_dropped_bytes_total 0\n");
      const {peers} = await get<{peers: {connections: {transport: string}[]}[]}>(`/api/peers?source=${source}`);
      expect(peers.flatMap((peer) => peer.connections).some((conn) => conn.transport === "quic-v1")).toBe(true);
      await local.close();
      local = undefined;
      await expect
        .poll(async () =>
          (await get<{sources: {source_id: string; connected: boolean}[]}>("/api/sources")).sources.every(
            (s) => !s.connected
          )
        )
        .toBe(true);
    } finally {
      spy.mockRestore();
      await local?.close();
      await remote?.close();
      collector.kill("SIGTERM");
      await exited;
      await rm(directory, {recursive: true, force: true});
    }
  },
  90_000
);
