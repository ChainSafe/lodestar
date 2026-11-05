// Adapts nflaig/dad413fbcca4e1772a708d3efe433c48 at e7024a67d20b375d5141fb464aeb0b5e325a2593.
// Usage: node interleaved.mjs <output directory> <EL URL> <CL URL> [more CL URLs]
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, readdir, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {join} from "node:path";
import {setTimeout} from "node:timers/promises";
import {DOMAIN_DEPOSIT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {PublicKey, SecretKey, Signature, verify} from "../../../bindings/src/blst.js";

const {ContractFactory, JsonRpcProvider, Wallet} = createRequire(
  new URL("../../../packages/cli/package.json", import.meta.url)
)("ethers");
const [output, elUrl, ...clUrls] = process.argv.slice(2);
assert(output && elUrl && clUrls.length >= 3, "expected output, EL URL and CL URLs");
for (const url of [elUrl, ...clUrls]) {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "local devnets only");
}
const hex = (value) => `0x${Buffer.from(value).toString("hex")}`;
const bytes = (value) => Uint8Array.from(Buffer.from(value.replace(/^0x/, ""), "hex"));
const json = (name, value) => writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
async function get(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return (await response.json()).data;
}
function queueHash(deposits) {
  const hash = createHash("sha256");
  for (const deposit of deposits) hash.update(ssz.phase0.DepositData.hashTreeRoot(deposit));
  return hash.digest("hex");
}

const spec = await get(`${clUrls[0]}/eth/v1/config/spec`);
const forkRoot = ssz.phase0.ForkData.hashTreeRoot({
  currentVersion: bytes(spec.GENESIS_FORK_VERSION),
  genesisValidatorsRoot: new Uint8Array(32),
});
const domain = new Uint8Array(32);
domain.set(DOMAIN_DEPOSIT);
domain.set(forkRoot.subarray(0, 28), 4);
const signingRoot = (deposit) =>
  ssz.phase0.SigningData.hashTreeRoot({domain, objectRoot: ssz.phase0.DepositMessage.hashTreeRoot(deposit)});
function key(index) {
  const entropy = new Uint8Array(32);
  new DataView(entropy.buffer).setUint32(0, index);
  const sk = SecretKey.fromKeygen(entropy);
  return {pubkey: sk.toPublicKey().toBytes(), sk};
}
const [a, b, c, d, wrong, blocker] = [91, 92, 93, 94, 999, 999999].map(key);
function credentials(prefix) {
  const result = new Uint8Array(32);
  result[0] = prefix;
  result.set(bytes("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"), 12);
  return result;
}
const validatorCredentials = credentials(1);
const builderCredentials = credentials(0xb0);
function deposit(owner, wc, amount = 1_000_000_000, options = {}) {
  const message = {amount, pubkey: owner.pubkey, withdrawalCredentials: wc};
  const signature =
    options.signature ??
    (options.signer ?? owner.sk)
      .sign(
        signingRoot({
          ...message,
          amount: options.signedAmount ?? amount,
          withdrawalCredentials: options.signedCredentials ?? wc,
        })
      )
      .toBytes();
  return {...message, signature};
}
function invalid(owner, wc, index) {
  switch (index % 50) {
    case 0:
      return deposit(owner, wc, undefined, {signature: new Uint8Array(96)});
    case 1: {
      const signature = new Uint8Array(96);
      signature[0] = 0xc0;
      return deposit(owner, wc, undefined, {signature});
    }
    case 2:
      return deposit(owner, wc, undefined, {signer: wrong.sk});
    case 3:
      return deposit(owner, wc, undefined, {
        signedCredentials: wc === validatorCredentials ? builderCredentials : validatorCredentials,
      });
    default:
      return deposit(owner, wc, undefined, {signedAmount: (index + 2) * 1_000_000_000});
  }
}
function valid(value) {
  try {
    return verify(
      signingRoot(value),
      PublicKey.fromBytes(value.pubkey, true),
      Signature.fromBytes(value.signature, true, true)
    );
  } catch {
    return false;
  }
}

const before = [];
let validatorIndex = 0;
for (let builderIndex = 0; builderIndex < 1300; builderIndex++) {
  const end = Math.round(((builderIndex + 1) * 4000) / 1300);
  while (validatorIndex < end) before.push(invalid(a, validatorCredentials, validatorIndex++));
  before.push(invalid(a, builderCredentials, builderIndex));
}
for (const [index, value] of before.entries()) assert.equal(valid(value), false, `valid prefix signature at ${index}`);

const malformed = [
  `80${"00".repeat(46)}04`,
  `c0${"00".repeat(47)}`,
  `80${"00".repeat(46)}01`,
  `c010${"00".repeat(46)}`,
].map((pubkey) => ({pubkey: bytes(pubkey), sk: wrong.sk}));
const malformedValidators = malformed.map((owner) => deposit(owner, validatorCredentials));
const malformedBuilders = malformed.flatMap((owner) =>
  Array.from({length: 5}, (_, index) =>
    deposit(owner, builderCredentials, undefined, {signedAmount: (10 + index) * 1_000_000_000})
  )
);
const destructive = [deposit(d, validatorCredentials), deposit(d, builderCredentials)];
// This unfittable head deposit preserves the entire ordered queue through the fork and capture.
const queueBlocker = deposit(blocker, credentials(2), 1024 * 1_000_000_000);
for (const [index, value] of [
  queueBlocker,
  ...[a, b, c, d].map((owner) => deposit(owner, builderCredentials)),
  ...destructive,
].entries()) {
  assert.equal(valid(value), true, `positive signature control ${index}`);
}
const filler = Array.from({length: 10000}, (_, index) => deposit(key(index + 1000), builderCredentials));
const values = [
  queueBlocker,
  ...malformedValidators,
  ...before,
  ...malformedBuilders,
  ...destructive,
  deposit(a, builderCredentials, 100 * 1_000_000_000),
  deposit(b, builderCredentials, 100 * 1_000_000_000),
  deposit(a, validatorCredentials),
  ...Array.from({length: 50}, (_, index) => invalid(a, index % 2 ? builderCredentials : validatorCredentials, index)),
  ...filler,
  deposit(c, builderCredentials),
  ...Array.from({length: 900}, (_, index) => invalid(c, index % 2 ? builderCredentials : validatorCredentials, index)),
];
const remaining = [
  queueBlocker,
  ...malformedValidators,
  ...before.filter((value) => value.withdrawalCredentials[0] === 1),
  ...destructive,
];
const manifest = {
  builderSequenceHash: createHash("sha256")
    .update(
      JSON.stringify([
        [hex(a.pubkey), "151000000000"],
        [hex(b.pubkey), "100000000000"],
        ...filler.map((value) => [hex(value.pubkey), String(value.amount)]),
        [hex(c.pubkey), "901000000000"],
      ])
    )
    .digest("hex"),
  builders: [
    {balance: "151000000000", index: 0, pubkey: hex(a.pubkey)},
    {balance: "100000000000", index: 1, pubkey: hex(b.pubkey)},
    {balance: "901000000000", index: 10002, pubkey: hex(c.pubkey)},
  ],
  deposits: values.length,
  excludedPubkeys: [d, ...malformed].map((owner) => hex(owner.pubkey)),
  gistRevision: "e7024a67d20b375d5141fb464aeb0b5e325a2593",
  outcomes: {dropped: 1320, kept: 4007, onboarded: 10003, topup: 951},
  queueHash: queueHash(values),
  remainingQueueHash: queueHash(remaining),
  scenario: "interleaved",
  // The standalone validator blocker has no builder trigger, so the fork never checks its signature.
  signatureChecks: before.length + malformedValidators.length + malformedBuilders.length + filler.length + 3 + 1,
};
assert.equal(values.length, 16281);
assert.equal(remaining.length, manifest.outcomes.kept);
await json("manifest.json", manifest);
await json(
  "deposits.json",
  values.map((value) => ssz.phase0.DepositData.toJson(value))
);
console.log(
  JSON.stringify({
    deposits: values.length,
    phase: "generated",
    prefixSafetyGate: "5300 invalid",
    queueHash: manifest.queueHash,
  })
);

const provider = new JsonRpcProvider(elUrl);
async function waitReceipt(hash) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) {
        assert.equal(receipt.status, 1, `reverted transaction ${hash}`);
        return receipt;
      }
    } catch (error) {
      if (error.error?.message !== "transaction indexing is in progress") throw error;
    }
    await setTimeout(2000);
  }
  assert.fail(`receipt timeout ${hash}`);
}
// Public Hardhat development key, funded only in this isolated genesis.
const wallet = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);
const files = await readdir(join(output, "contract"));
const base = files.find((file) => file.endsWith("_InterleavedDeposit.abi"));
assert(base, "compile InterleavedDeposit.sol before submission");
const abi = JSON.parse(await readFile(join(output, "contract", base), "utf8"));
const bytecode = `0x${(await readFile(join(output, "contract", base.replace(/\.abi$/, ".bin")), "utf8")).trim()}`;
const fees = {maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n};
const contract = await new ContractFactory(abi, bytecode, wallet).deploy(spec.DEPOSIT_CONTRACT_ADDRESS, {
  ...fees,
  gasLimit: 2_000_000,
});
await waitReceipt(contract.deploymentTransaction().hash);
const contractAddress = await contract.getAddress();
const chainId = (await provider.getNetwork()).chainId;
let nonce = await provider.getTransactionCount(wallet.address, "pending");
const receipts = [];
for (let start = 0; start < values.length; start += 120 * 32) {
  const transactions = [];
  for (let offset = start; offset < Math.min(values.length, start + 120 * 32); offset += 120) {
    const batch = values.slice(offset, offset + 120);
    const entries = batch.map((value) => [
      value.pubkey,
      value.withdrawalCredentials,
      value.signature,
      ssz.phase0.DepositData.hashTreeRoot(value),
      BigInt(value.amount) * 1_000_000_000n,
    ]);
    const raw = await wallet.signTransaction({
      chainId,
      data: contract.interface.encodeFunctionData("submit", [entries]),
      gasLimit: 15_000_000,
      nonce: nonce++,
      to: contractAddress,
      type: 2,
      value: entries.reduce((total, entry) => total + entry[4], 0n),
      ...fees,
    });
    transactions.push(await provider.broadcastTransaction(raw));
  }
  for (const tx of transactions) {
    const receipt = await waitReceipt(tx.hash);
    receipts.push({blockNumber: receipt.blockNumber, hash: tx.hash, logs: receipt.logs.length});
  }
  console.log(JSON.stringify({deposits: Math.min(values.length, start + 120 * 32), phase: "submitted"}));
}
assert.equal(
  receipts.reduce((total, receipt) => total + receipt.logs, 0),
  values.length,
  "deposit event count"
);
await json("receipts.json", receipts);

const windowStart = (Number(spec.GLOAS_FORK_EPOCH) - 2) * Number(spec.SLOTS_PER_EPOCH);
const deadline = Date.now() + 5 * 60_000;
const captures = new Map();
while (Date.now() < deadline && captures.size < clUrls.length) {
  for (const [index, url] of clUrls.entries()) {
    if (captures.has(index)) continue;
    const header = await get(`${url}/eth/v1/beacon/headers/head`);
    assert(
      Number(header.header.message.slot) < windowStart,
      `node ${index + 1}: queue was not ready before the two-epoch window`
    );
    const data = await get(`${url}/eth/v1/beacon/states/${header.header.message.state_root}/pending_deposits`);
    if (data.length !== values.length) continue;
    assert.equal(
      queueHash(data.map((value) => ssz.electra.PendingDeposit.fromJson(value))),
      manifest.queueHash,
      `node ${index + 1}: deposit order`
    );
    await json(`node-${index + 1}-queue-before.json`, data);
    captures.set(index, {count: data.length, queueHash: manifest.queueHash, slot: header.header.message.slot});
  }
  if (captures.size < clUrls.length) await setTimeout(3000);
}
assert.equal(captures.size, clUrls.length, "all nodes must observe the exact ordered queue before warming");
await json(
  "queue-captures.json",
  Array.from(captures, ([index, capture]) => ({node: index + 1, ...capture}))
);
console.log(JSON.stringify({deposits: values.length, nodes: captures.size, phase: "queue-verified"}));
provider.destroy();
