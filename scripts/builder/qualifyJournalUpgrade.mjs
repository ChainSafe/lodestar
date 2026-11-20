import assert from "node:assert/strict";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const [mode, repository, directory] = process.argv.slice(2);
assert.ok(
  ["write", "read"].includes(mode) && repository && directory,
  "Usage: node qualifyJournalUpgrade.mjs <write|read> <built-repository> <empty-journal-directory>"
);
const load = (path) => import(pathToFileURL(resolve(repository, path)));
const {ssz} = await load("packages/types/lib/index.js");
const {CommitmentJournal} = await load("packages/builder/lib/services/commitmentJournal.js");
const {PayloadStore} = await load("packages/builder/lib/services/payloadStore.js");
const {BidStore} = await load("packages/builder/lib/services/bidStore.js");
const {BidLedger} = await load("packages/builder/lib/services/bidLedger.js");
const hex = (bytes) => "0x" + Buffer.from(bytes).toString("hex");
const identity = {genesisValidatorsRoot: hex(Buffer.alloc(32, 1)), pubkey: "upgrade-fixture"};
const slot = 100;
const expectedPath = resolve(directory, "../journal-upgrade-expected.json");
if (mode === "write") {
  mkdirSync(directory, {recursive: false});
  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  assert.ok(Array.isArray(executionPayload.transactions), "Writer must use the old transaction-array representation");
  executionPayload.transactions = [new Uint8Array([2, 1, 2, 3]), new Uint8Array([4, 5, 6])];
  executionPayload.slotNumber = slot;
  executionPayload.blockHash.fill(2);
  executionPayload.parentHash.fill(3);
  const payload = {
    sourceId: "fixture",
    executionPayload,
    executionPayloadValue: 1_000_000_000n,
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle: ssz.fulu.BlobsBundle.defaultValue(),
  };
  const signed = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  signed.message.slot = slot;
  signed.message.blockHash = executionPayload.blockHash;
  signed.message.parentBlockHash = executionPayload.parentHash;
  signed.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  signed.message.value = 1;
  signed.signature.fill(1);
  const journal = new CommitmentJournal(directory, identity);
  await journal.retain(signed, {
    slot,
    blockHash: hex(executionPayload.blockHash),
    parentBlockRoot: signed.message.parentBlockRoot,
    payload,
  });
  writeFileSync(
    expectedPath,
    JSON.stringify({
      payload: hex(ssz.gloas.ExecutionPayload.serialize(executionPayload)),
      bid: hex(ssz.gloas.SignedExecutionPayloadBid.serialize(signed)),
      blockHash: hex(executionPayload.blockHash),
    })
  );
  console.log(JSON.stringify({written: true, transactions: executionPayload.transactions.length}));
} else {
  const expected = JSON.parse(readFileSync(expectedPath));
  const journal = new CommitmentJournal(directory, identity);
  const payloads = new PayloadStore(),
    bids = new BidStore(),
    ledger = new BidLedger();
  assert.equal(journal.recover(slot, payloads, bids, ledger), 1);
  const recovered = payloads.get(expected.blockHash);
  assert.ok(recovered);
  assert.ok(!Array.isArray(recovered.payload.executionPayload.transactions), "Reader must use serialized transactions");
  assert.equal(hex(ssz.gloas.ExecutionPayload.serialize(recovered.payload.executionPayload)), expected.payload);
  const bid = ssz.gloas.SignedExecutionPayloadBid.deserialize(Buffer.from(expected.bid.slice(2), "hex"));
  assert.ok(bids.has(bid));
  assert.equal(bids.canOffer(bid), false, "Recovery preserves reveal obligations without granting a fresh offer");
  assert.ok(
    ledger
      .getBidsForSlot(slot)
      .some((record) => record.signedBidRoot === hex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(bid)))
  );
  console.log(
    JSON.stringify({
      recovered: true,
      payloadBytesEqual: true,
      signedBidRootEqual: true,
      transactions: recovered.payload.executionPayload.transactions.length,
    })
  );
}
