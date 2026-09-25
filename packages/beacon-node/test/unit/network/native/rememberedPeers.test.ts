import fs from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {NativeRememberedPeer, NativeRememberedPeersSnapshot} from "@chainsafe/lodestar-z/network";
import {TimeoutError, defer, toHex} from "@lodestar/utils";
import {RememberedPeersWriter, readRememberedPeers} from "../../../../src/network/core/native/rememberedPeers.js";

const root = new Uint8Array(32).fill(7);
const nowS = Math.floor(Date.now() / 1000);
const [a, b, c] = await Promise.all(
  [0, 1, 2].map(async () => peerIdFromPrivateKey(await generateKeyPair("secp256k1")).toString())
);
const ed25519 = peerIdFromPrivateKey(await generateKeyPair("Ed25519")).toString();

function peer(peerId: string, port = 9000, qualifiedAtUnixS = nowS - 60, family: 4 | 6 = 4): NativeRememberedPeer {
  const address = family === 4 ? Uint8Array.of(10, 0, 0, 1) : Uint8Array.of(0x20, 0x01, 0x0d, 0xb8, ...Array(11), 1);
  return {peerId, endpoint: {family, address, port}, qualifiedAtUnixS};
}

function encoded(peers: NativeRememberedPeer[]): object[] {
  return peers.map(({peerId, endpoint, qualifiedAtUnixS}) => ({
    peerId,
    endpoint: {...endpoint, address: toHex(endpoint.address)},
    qualifiedAtUnixS,
  }));
}

function snapshot(peers: NativeRememberedPeer[]): NativeRememberedPeersSnapshot {
  return {genesisValidatorsRoot: root, peers, ownerSequence: 1n};
}

describe("native remembered peers file", () => {
  let dir: string;
  let file: string;
  const logger = {error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn(), debug: vi.fn()};

  beforeEach(() => {
    dir = join(fs.mkdtempSync(join(tmpdir(), "lodestar-remembered-")), "peerstore");
    file = join(dir, "native-remembered-peers.json");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fs.rmSync(join(dir, ".."), {recursive: true, force: true});
  });

  function write(content: unknown): void {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }

  it("writes the snapshot into a new directory and reads it back as the seed", async () => {
    const peers = [peer(a, 9000), peer(b, 9001, nowS - 120, 6)];
    await new RememberedPeersWriter(dir, {getRememberedPeers: async () => snapshot(peers)}, logger).close();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      version: 1,
      genesisValidatorsRoot: toHex(root),
      peers: [
        {peerId: a, endpoint: {family: 4, address: "0x0a000001", port: 9000}, qualifiedAtUnixS: nowS - 60},
        {
          peerId: b,
          endpoint: {family: 6, address: "0x20010db8000000000000000000000001", port: 9001},
          qualifiedAtUnixS: nowS - 120,
        },
      ],
    });
    expect(fs.readdirSync(dir)).toEqual(["native-remembered-peers.json"]);
    expect(readRememberedPeers(dir, root, logger)).toEqual({genesisValidatorsRoot: root, peers});
    expect(logger.debug).toHaveBeenCalledWith("Loaded native remembered peers", {peers: 2});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("starts cold without a file", () => {
    expect(readRememberedPeers(dir, root, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith("No native remembered peers", {file});
    expect(logger.info).not.toHaveBeenCalled();
  });

  const valid = (peers: object[] = encoded([peer(a)])) => ({version: 1, genesisValidatorsRoot: toHex(root), peers});
  const [entry] = encoded([peer(a)]) as {peerId: string; endpoint: object; qualifiedAtUnixS: number}[];
  const withEndpoint = (endpoint: object) => valid([{...entry, endpoint: {...entry.endpoint, ...endpoint}}]);
  it.each<[string, unknown]>([
    ["corrupt JSON", JSON.stringify(valid()).slice(0, -1)],
    ["an oversize file", JSON.stringify(valid()).padEnd(128 * 1024 + 1)],
    ["another version", {...valid(), version: 2}],
    ["another network", {...valid(), genesisValidatorsRoot: toHex(new Uint8Array(32))}],
    ["more than 256 peers", valid(encoded(Array.from({length: 257}, () => peer(a))))],
    ["no peer list", {...valid(), peers: {}}],
    ["a peer without an endpoint", valid([{peerId: a, qualifiedAtUnixS: nowS}])],
    ["an invalid peer id", valid([{...entry, peerId: "16Uiu2HAm"}])],
    ["an Ed25519 peer id", valid([{...entry, peerId: ed25519}])],
    ["an unknown family", withEndpoint({family: 5})],
    ["an IPv6 address for IPv4", withEndpoint({address: "0x20010db8000000000000000000000001"})],
    ["an unspecified address", withEndpoint({address: "0x00000000"})],
    ["an IPv4-mapped IPv6 address", withEndpoint({family: 6, address: "0x00000000000000000000ffff0a000001"})],
    ["port 0", withEndpoint({port: 0})],
    ["a port above 65535", withEndpoint({port: 65536})],
    ["a fractional qualification time", valid([{...entry, qualifiedAtUnixS: nowS - 0.5}])],
    ["a negative qualification time", valid([{...entry, qualifiedAtUnixS: -1}])],
  ])("starts cold with %s", (_, content) => {
    write(content);
    expect(readRememberedPeers(dir, root, logger)).toBeNull();
    expect(logger.info).toHaveBeenCalledWith("Ignoring native remembered peers", {file}, expect.any(Error));
  });

  it("accepts a file of exactly 128 KiB", () => {
    write(JSON.stringify(valid()).padEnd(128 * 1024));
    expect(readRememberedPeers(dir, root, logger)?.peers).toEqual([peer(a)]);
  });

  it("drops expired records and keeps the newest record of each identity", () => {
    write(
      valid(
        encoded([
          peer(a, 9000, nowS - 10),
          peer(b, 9000, nowS - 24 * 60 * 60),
          peer(a, 9001, nowS - 5),
          peer(c, 9000, nowS - 24 * 60 * 60 + 60),
          peer(a, 9002, nowS - 20),
        ])
      )
    );
    expect(readRememberedPeers(dir, root, logger)?.peers).toEqual([
      peer(a, 9001, nowS - 5),
      peer(c, 9000, nowS - 24 * 60 * 60 + 60),
    ]);
  });

  it.each(["writeFile", "rename"] as const)("keeps the previous file when %s fails", async (step) => {
    write(valid());
    const previous = fs.readFileSync(file, "utf8");
    const failure = new Error(`${step} interrupted`);
    if (step === "rename") vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(failure);
    else
      vi.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (temporary) => {
        await fs.promises.appendFile(temporary as string, '{"version":');
        throw failure;
      });
    await new RememberedPeersWriter(dir, {getRememberedPeers: async () => snapshot([peer(b)])}, logger).close();
    expect(fs.readFileSync(file, "utf8")).toBe(previous);
    expect(fs.readdirSync(dir)).toEqual(["native-remembered-peers.json"]);
    expect(logger.warn).toHaveBeenCalledWith("Native remembered peers write failed", {file}, failure);
  });

  it("keeps the previous file when the runtime refuses the final snapshot", async () => {
    write(valid());
    const previous = fs.readFileSync(file, "utf8");
    const closed = new Error("NetworkClosed");
    const runtime = {
      getRememberedPeers: (): Promise<NativeRememberedPeersSnapshot> => {
        throw closed;
      },
    };
    await new RememberedPeersWriter(dir, runtime, logger).close();
    expect(fs.readFileSync(file, "utf8")).toBe(previous);
    expect(logger.warn).toHaveBeenCalledWith("Native remembered peers write failed", {file}, closed);
  });

  describe("schedule", () => {
    beforeEach(() => vi.useFakeTimers({toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"]}));

    /** Lets real file I/O run while the fake clock stands still, until `condition` holds or `ms` pass. */
    async function until(condition: () => boolean, ms = 5000): Promise<void> {
      const deadline = performance.now() + ms;
      while (!condition() && performance.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
    }

    it("writes every 5 minutes on an unreferenced timer, one write at a time, until close", async () => {
      const interval = vi.spyOn(globalThis, "setInterval");
      const snapshots: ReturnType<typeof defer<NativeRememberedPeersSnapshot>>[] = [];
      const seen: (string | null)[] = [];
      const runtime = {
        getRememberedPeers: vi.fn(() => {
          seen.push(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
          const next = defer<NativeRememberedPeersSnapshot>();
          snapshots.push(next);
          return next.promise;
        }),
      };
      const writer = new RememberedPeersWriter(dir, runtime, logger);
      expect((interval.mock.results[0].value as NodeJS.Timeout).hasRef()).toBe(false);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
      expect(runtime.getRememberedPeers).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(runtime.getRememberedPeers).toHaveBeenCalledOnce();
      // Ticks while a write is in flight start none, and the final write waits for it.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      const closing = writer.close();
      await until(() => snapshots.length > 1, 50);
      expect(runtime.getRememberedPeers).toHaveBeenCalledOnce();
      snapshots[0].resolve(snapshot([peer(a)]));
      await until(() => snapshots.length === 2);
      expect(runtime.getRememberedPeers).toHaveBeenCalledTimes(2);
      snapshots[1].resolve(snapshot([peer(b)]));
      await closing;
      expect(seen).toEqual([null, JSON.stringify(valid())]);
      expect(readRememberedPeers(dir, root, logger)?.peers).toEqual([peer(b)]);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(runtime.getRememberedPeers).toHaveBeenCalledTimes(2);
    });

    it("bounds the final snapshot and write to 2 seconds", async () => {
      const runtime = {getRememberedPeers: vi.fn(() => new Promise<NativeRememberedPeersSnapshot>(() => {}))};
      let closed = false;
      const closing = new RememberedPeersWriter(dir, runtime, logger).close().then(() => {
        closed = true;
      });
      await vi.advanceTimersByTimeAsync(1999);
      expect(runtime.getRememberedPeers).toHaveBeenCalledOnce();
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(logger.warn).toHaveBeenCalledWith(
        "Native remembered peers not written at close",
        {file},
        expect.any(TimeoutError)
      );
      expect(fs.existsSync(file)).toBe(false);
    });
  });
});
