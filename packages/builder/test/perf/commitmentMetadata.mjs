import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {SecretKey} from "@lodestar/native/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";

// Run identical compiled baseline/candidate revisions on the same filesystem.
// This measures signing plus worker retention acknowledgement, not network delivery.
const [implementation, orderCountArg = "0", blobsArg = "0", revisionsArg = "48"] = process.argv.slice(2);
const orderCount = Number(orderCountArg);
const blobCount = Number(blobsArg);
const revisions = Number(revisionsArg);
if (
  !implementation ||
  ![0, 64, 256].includes(orderCount) ||
  ![0, 4].includes(blobCount) ||
  revisions < 1 ||
  revisions > 64
)
  throw Error("Usage: node commitmentMetadata.mjs <repository> <0|64|256 orders> <0|4 blobs> [1..64 revisions]");
const load = (name) => import(pathToFileURL(path.join(implementation, "packages/builder/lib/services", `${name}.js`)));
const {AsyncCommitmentJournal} = await load("asyncCommitmentJournal");
const {BidPublisher} = await load("bidPublisher");
const {BidLedger} = await load("bidLedger");
const {BuilderSigner} = await load("builderSigner");
const {PayloadStore} = await load("payloadStore");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commitment-metadata-bench-"));
const primaryDirectory = path.join(directory, "primary");
const stagedDirectory = path.join(directory, "staged");
const key = SecretKey.fromBytes(Buffer.alloc(32, 1));
const signer = new BuilderSigner(createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32)), {
  secretKey: key,
  publicKey: key.toPublicKey(),
});
const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32)), pubkey: toHex(key.toPublicKey().toBytes())};
const primary = await AsyncCommitmentJournal.start({directory: primaryDirectory, identity});
const staged = await AsyncCommitmentJournal.start({
  directory: stagedDirectory,
  identity,
  sharedPayloadDirectory: primaryDirectory,
});
const store = new PayloadStore();
const journals = [primary, staged];
const publishers = journals.map(
  (journal, index) =>
    new BidPublisher({
      config: getConfig(ForkName.gloas),
      signer,
      builderIndex: index,
      ledger: new BidLedger(),
      hasPayload: ({blockHash}) => store.has(blockHash),
      api: {},
      retainCommitment: async (bid) => {
        const stored = store.get(toRootHex(bid.message.blockHash));
        if (!stored) throw Error("Missing benchmark payload");
        if (index === 0) await journal.retain(bid, stored);
        else await journal.retainShared(bid, stored, primary.getReference(stored));
      },
    })
);
const rows = [];
const bodyDigest = createHash("sha256");
try {
  for (let i = 0; i < revisions; i++) {
    const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
    executionPayload.slotNumber = 100;
    executionPayload.blockHash = createHash("sha256").update(`fixture-${i}`).digest();
    executionPayload.parentHash = Buffer.alloc(32, 2);
    executionPayload.transactions = Array.from({length: 150}, (_, n) => Buffer.alloc(180, n));
    bodyDigest.update(ssz.gloas.ExecutionPayload.serialize(executionPayload));
    const payload = {
      sourceId: "synthetic-metadata-benchmark",
      executionPayload,
      executionPayloadValue: 1000000000000000n,
      executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
      blobsBundle: {
        blobs: Array.from({length: blobCount}, (_, n) => Buffer.alloc(131072, n)),
        commitments: Array.from({length: blobCount}, (_, n) => Buffer.alloc(48, n)),
        proofs: Array.from({length: blobCount * 128}, (_, n) => Buffer.alloc(48, n)),
      },
      ...(orderCount > 0
        ? {
            orderMetadata: {
              version: 1,
              orderIds: Array.from({length: orderCount}, (_, n) => `0x${n.toString(16).padStart(64, "0")}`),
              doNotOfferBefore: 0,
            },
          }
        : {}),
    };
    store.add({
      slot: 100,
      parentBlockRoot: Buffer.alloc(32, 3),
      blockHash: toRootHex(executionPayload.blockHash),
      payload,
    });
    const row = [];
    for (let index = 0; index < publishers.length; index++) {
      const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
      bid.slot = 100;
      bid.builderIndex = index;
      bid.value = 1;
      bid.blockHash = executionPayload.blockHash;
      bid.parentBlockHash = executionPayload.parentHash;
      bid.parentBlockRoot = Buffer.alloc(32, 3);
      bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
      bid.blobKzgCommitments = payload.blobsBundle.commitments;
      const started = performance.now();
      await publishers[index].prepare(bid);
      row.push(performance.now() - started);
    }
    rows.push({revision: i, primaryMs: row[0], stagedMs: row[1]});
  }
  const files = [primaryDirectory, stagedDirectory].flatMap((root) =>
    fs.readdirSync(root).map((name) => fs.statSync(path.join(root, name)).size)
  );
  process.stdout.write(
    `${JSON.stringify({implementation, orderCount, blobCount, revisions, bodySha256: bodyDigest.digest("hex"), retainedFiles: files.length, retainedBytes: files.reduce((a, b) => a + b, 0), rows})}\n`
  );
} finally {
  await Promise.all(journals.map((journal) => journal.close()));
  fs.rmSync(directory, {recursive: true, force: true});
}
