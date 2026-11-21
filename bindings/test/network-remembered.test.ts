import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {privateKeyFromRaw} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {afterEach, beforeEach, expect, test} from "vitest";
import bindings from "../src/index.js";
import {applicationConfig, startRuntime, testChain} from "./utils/network.js";

const filename = "native-remembered-peers.txt";
const root = new Uint8Array(32).fill(42);
const header = `lodestar-peers-v1 ${Buffer.from(root).toString("hex")}\n`;
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "native-peers-"));
});
afterEach(async () => {
  await rm(directory, {force: true, recursive: true});
});

function config() {
  return {...applicationConfig(), beaconConfig: new bindings.BeaconConfig(testChain, root), peerStoreDir: directory};
}

function peer(tag: number): string {
  const secret = new Uint8Array(32);
  secret[31] = tag;
  return peerIdFromPublicKey(privateKeyFromRaw(secret).publicKey).toString();
}

test("native loads usable peer records and replaces the cache before close resolves", async () => {
  const now = Math.floor(Date.now() / 1000);
  const line = `${peer(2)} 127.0.0.1 49999 ${now - 60}\n`;
  const expired = `${peer(3)} 127.0.0.1 49998 ${now - 2 * 86400}\n`;
  await writeFile(join(directory, filename), `${header}${line}${line}${expired}broken entry\n`);
  const runtime = startRuntime(config());
  try {
    const metrics = await runtime.getMetrics();
    expect(metrics).toContain('lodestar_peer_remembered_seeds_total{outcome="loaded"} 1');
    expect(metrics).toContain('lodestar_peer_remembered_seeds_total{outcome="duplicate"} 1');
    expect(metrics).toContain('lodestar_peer_remembered_seeds_total{outcome="expired"} 1');
  } finally {
    await runtime.close();
  }
  const saved = await readFile(join(directory, filename), "utf8");
  expect(saved.startsWith(header)).toBe(true);
  expect(saved).not.toContain("broken entry");
  expect(saved).not.toContain(peer(3));
  expect(await readdir(directory)).toEqual([filename]);
});

test("native creates the peer directory and owns the genesis root after configuration is released", async () => {
  const options = config();
  options.peerStoreDir = join(directory, "missing", "peers");
  const mutableRoot = root.slice();
  options.beaconConfig = new bindings.BeaconConfig(testChain, mutableRoot);
  const runtime = startRuntime(options);
  try {
    options.beaconConfig = applicationConfig().beaconConfig;
    mutableRoot.fill(0);
    global.gc?.();
  } finally {
    await runtime.close();
  }
  expect(await readFile(join(options.peerStoreDir, filename), "utf8")).toBe(header);
});

test.each(["foreign root", "invalid header", "nonregular file"])("starts cold with %s", async (kind) => {
  const path = join(directory, filename);
  if (kind === "nonregular file") await mkdir(path);
  else await writeFile(path, kind === "foreign root" ? header.replaceAll("2a", "ff") : "bad header\n");
  const runtime = startRuntime(config());
  await runtime.close();
  if (kind !== "nonregular file") expect(await readFile(path, "utf8")).toBe(header);
  expect(await readdir(directory)).toEqual([filename]);
});

test("directory creation failure disables persistence without failing the runtime", async () => {
  const options = config();
  options.peerStoreDir = join(directory, "regular-file");
  await writeFile(options.peerStoreDir, "keep");
  const runtime = startRuntime(options);
  try {
    expect(await runtime.observeIdentity()).toBeDefined();
  } finally {
    await runtime.close();
  }
  expect(await readFile(options.peerStoreDir, "utf8")).toBe("keep");
});

test.each(["", "a\0b", "x".repeat(1025), 1, null])("rejects invalid peer directory %#", (path) => {
  const options = applicationConfig();
  Reflect.set(options, "peerStoreDir", path);
  expect(() => startRuntime(options)).toThrow("InvalidNetworkConfig");
});
