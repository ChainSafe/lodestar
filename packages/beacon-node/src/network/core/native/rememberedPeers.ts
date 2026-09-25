import fs from "node:fs";
import path from "node:path";
import {peerIdFromPublicKey, peerIdFromString} from "@libp2p/peer-id";
import {
  NativeNetworkApplicationRuntime,
  NativeRememberedPeer,
  NativeRememberedPeers,
} from "@chainsafe/lodestar-z/network";
import {Logger, fromHex, toHex, withTimeout} from "@lodestar/utils";

/** `{version, genesisValidatorsRoot, peers}` in the shape of `NativeRememberedPeers`, bytes as 0x-prefixed hex. */
const FILE_NAME = "native-remembered-peers.json";
const VERSION = 1;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_PEERS = 256;
const EXPIRY_S = 24 * 60 * 60;
const WRITE_INTERVAL_MS = 5 * 60 * 1000;
const FINAL_WRITE_TIMEOUT_MS = 2000;

/**
 * The seed for native init: the unexpired peers an earlier run of this network remembered, one per identity.
 * A missing, oversized or malformed file, or another network's, means a cold start: null.
 */
export function readRememberedPeers(
  dir: string,
  genesisValidatorsRoot: Uint8Array,
  logger: Logger
): NativeRememberedPeers | null {
  const file = path.join(dir, FILE_NAME);
  try {
    const peers = parsePeers(readBounded(file), toHex(genesisValidatorsRoot));
    logger.debug("Loaded native remembered peers", {peers: peers.length});
    return {genesisValidatorsRoot, peers};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") logger.debug("No native remembered peers", {file});
    else logger.info("Ignoring native remembered peers", {file}, error as Error);
    return null;
  }
}

function readBounded(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length > MAX_FILE_BYTES) throw Error(`File exceeds ${MAX_FILE_BYTES} bytes`);
    return buffer.toString("utf8", 0, length);
  } finally {
    fs.closeSync(fd);
  }
}

function parsePeers(text: string, root: string): NativeRememberedPeer[] {
  const file = JSON.parse(text) as unknown;
  if (!isObject(file) || file.version !== VERSION) throw Error("Unsupported version");
  if (file.genesisValidatorsRoot !== root) throw Error("Another network");
  if (!Array.isArray(file.peers) || file.peers.length > MAX_PEERS) throw Error(`Expected at most ${MAX_PEERS} peers`);
  const nowS = Math.floor(Date.now() / 1000);
  const newest = new Map<string, NativeRememberedPeer>();
  for (const entry of file.peers) {
    const peer = parsePeer(entry);
    const kept = newest.get(peer.peerId);
    if (nowS - peer.qualifiedAtUnixS < EXPIRY_S && (!kept || peer.qualifiedAtUnixS > kept.qualifiedAtUnixS))
      newest.set(peer.peerId, peer);
  }
  return Array.from(newest.values());
}

/** Native rejects the whole seed for one malformed peer, so these are its rules. */
function parsePeer(entry: unknown): NativeRememberedPeer {
  if (!isObject(entry) || !isObject(entry.endpoint)) throw Error("Malformed peer");
  const {peerId, qualifiedAtUnixS} = entry;
  const {family, address, port} = entry.endpoint;
  if (
    typeof peerId !== "string" ||
    (family !== 4 && family !== 6) ||
    typeof address !== "string" ||
    !(family === 4 ? /^0x[0-9a-f]{8}$/ : /^0x[0-9a-f]{32}$/).test(address) ||
    !isInteger(port, 1, 65535) ||
    !isInteger(qualifiedAtUnixS, 0, Number.MAX_SAFE_INTEGER)
  )
    throw Error("Malformed peer");
  if (/^0x0+$/.test(address) || (family === 6 && address.startsWith(`0x${"0".repeat(20)}ffff`)))
    throw Error("Unusable endpoint");
  const id = peerIdFromString(peerId);
  if (id.type !== "secp256k1" || peerIdFromPublicKey(id.publicKey).toString() !== peerId)
    throw Error("Not a native peer id");
  return {peerId, endpoint: {family, address: fromHex(address), port}, qualifiedAtUnixS};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

/**
 * Persists native's remembered peers every 5 minutes and once more at close, one write at a time, through a
 * same-directory temporary file so that a failed write keeps the previous file.
 */
export class RememberedPeersWriter {
  private readonly file: string;
  private readonly timer: NodeJS.Timeout;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "getRememberedPeers">,
    private readonly logger: Logger
  ) {
    this.file = path.join(dir, FILE_NAME);
    this.timer = setInterval(() => {
      if (!this.writing) void this.write();
    }, WRITE_INTERVAL_MS);
    this.timer.unref();
  }

  /** Stops the timer and writes the final snapshot within 2 s; call it before the runtime closes and refuses one. */
  async close(): Promise<void> {
    clearInterval(this.timer);
    try {
      await withTimeout(async () => {
        await this.writing;
        await this.write();
      }, FINAL_WRITE_TIMEOUT_MS);
    } catch (error) {
      this.logger.warn("Native remembered peers not written at close", {file: this.file}, error as Error);
    }
  }

  private write(): Promise<void> {
    this.writing = this.persist()
      .catch((error: unknown) =>
        this.logger.warn("Native remembered peers write failed", {file: this.file}, error as Error)
      )
      .finally(() => {
        this.writing = null;
      });
    return this.writing;
  }

  private async persist(): Promise<void> {
    const {genesisValidatorsRoot, peers} = await this.runtime.getRememberedPeers();
    const json = JSON.stringify({
      version: VERSION,
      genesisValidatorsRoot: toHex(genesisValidatorsRoot),
      peers: peers.map(({peerId, endpoint, qualifiedAtUnixS}) => ({
        peerId,
        endpoint: {family: endpoint.family, address: toHex(endpoint.address), port: endpoint.port},
        qualifiedAtUnixS,
      })),
    });
    const temporary = `${this.file}.tmp`;
    await fs.promises.mkdir(this.dir, {recursive: true});
    try {
      await fs.promises.writeFile(temporary, json);
      await fs.promises.rename(temporary, this.file);
    } catch (error) {
      await fs.promises.rm(temporary, {force: true}).catch(() => {});
      throw error;
    }
  }
}
