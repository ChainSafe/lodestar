import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {Key} from "interface-datastore";
import {Libp2p, createLibp2p} from "libp2p";
import {afterEach, beforeEach, expect, it} from "vitest";
import {LevelDb} from "@chainsafe/lodestar-z/leveldb";
import {createNodeJsLibp2p} from "../../../../src/network/libp2p/index.js";
import {Eth2PeerDataStore} from "../../../../src/network/peers/datastore.js";

let directory: string;
let node: Libp2p | undefined;
let datastore: Eth2PeerDataStore | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "lodestar-peer-lifecycle-"));
});

afterEach(async () => {
  await node?.stop();
  await datastore?.close();
  node = undefined;
  datastore = undefined;
  await rm(directory, {recursive: true, force: true});
});

it("flushes peers and releases the database lock when the node stops", async () => {
  const created = await createNodeJsLibp2p(
    await generateKeyPair("secp256k1"),
    {localMultiaddrs: [], tcp: true, quic: false},
    {peerStoreDir: directory, disablePeerDiscovery: true}
  );
  node = created;
  const peers = created.services.components.datastore;
  if (!(peers instanceof Eth2PeerDataStore)) throw Error("Expected persistent peer datastore");
  datastore = peers;
  await peers.put(new Key("/peer"), Uint8Array.of(7));
  await node.stop();

  const reopened = await LevelDb.open(directory);
  try {
    expect(await reopened.get(Buffer.from("/peer"))).toEqual(Uint8Array.of(7));
  } finally {
    await reopened.close();
  }
});

it.each([false, true])("keeps the database open through component shutdown, startup failure: %s", async (fail) => {
  const peers = new Eth2PeerDataStore(directory);
  datastore = peers;
  const key = new Key("/peer");
  const failure = new Error("component startup failed");
  const creating = createLibp2p({
    datastore: peers,
    services: {
      writer: () => ({
        async start() {
          expect(await peers.has(key)).toBe(false);
          if (fail) throw failure;
        },
        async stop() {
          await peers.put(key, Uint8Array.of(9));
        },
      }),
    },
  });
  if (fail) await expect(creating).rejects.toBe(failure);
  else {
    node = await creating;
    await node.stop();
  }

  const reopened = await LevelDb.open(directory);
  try {
    expect(await reopened.get(Buffer.from("/peer"))).toEqual(Uint8Array.of(9));
  } finally {
    await reopened.close();
  }
});
