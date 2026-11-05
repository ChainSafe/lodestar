// Usage: node check.mjs <output directory> <expected deposits> <CL URL> <metrics URL> (native, TS, native[, TS])
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {appendFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {setTimeout} from "node:timers/promises";
import {ssz} from "@lodestar/types";

const [output, count, ...urls] = process.argv.slice(2);
assert(
  output && Number(count) > 0 && [6, 8].includes(urls.length),
  "expected output, count and three or four CL/metrics URL pairs"
);
const clients = Array.from({length: urls.length / 2}, (_, i) => ({api: urls[2 * i], metrics: urls[2 * i + 1]}));
for (const client of clients) {
  for (const url of [client.api, client.metrics]) {
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
      "only local Kurtosis endpoints are supported"
    );
  }
}
await mkdir(output, {recursive: true});
const manifest = await readFile(join(output, "manifest.json"), "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
if (manifest) assert.equal(Number(count), manifest.deposits, "deposit count must match the fixture");

async function get(url, json = true) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  assert(response.ok, `${url}: HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

function metric(text, name, label) {
  const lines = text.split("\n").filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `));
  return lines
    .filter((line) => label === undefined || line.includes(label))
    .reduce((sum, line) => sum + Number(line.split(" ").at(-1)), 0);
}

const spec = (await get(`${clients[0].api}/eth/v1/config/spec`)).data;
const forkEpoch = Number(spec.GLOAS_FORK_EPOCH);
const forkSlot = forkEpoch * Number(spec.SLOTS_PER_EPOCH);
assert(Number.isSafeInteger(forkSlot), "Gloas must be scheduled");
const peak = clients.map(() => ({cacheHitsAtFork: 0, cached: 0, onboarding: 0, pending: 0, verifiedAtFork: 0}));
const forkChecks = clients.map(() => []);
const expectedChecks = manifest?.signatureChecks ?? Number(count) * 0.95;
const expectedPending = manifest?.deposits ?? Number(count) * 0.95;
const deadline = Date.now() + 45 * 60_000;
let finalized = false;
let sharedHeader;
let forkSnapshots;

async function captureFork() {
  let header;
  for (let slot = forkSlot; slot < forkSlot + Number(spec.SLOTS_PER_EPOCH); slot++) {
    const responses = await Promise.all(
      clients.map((client) =>
        fetch(`${client.api}/eth/v1/beacon/headers/${slot}`, {signal: AbortSignal.timeout(30_000)})
      )
    );
    if (responses.some((response) => response.status === 404)) continue;
    for (const response of responses) assert(response.ok, `fork header HTTP ${response.status}`);
    const headers = await Promise.all(responses.map((response) => response.json()));
    for (const value of headers.slice(1))
      assert.deepEqual(value.data.header.message, headers[0].data.header.message, `fork block ${slot}`);
    header = headers[0].data.header.message;
    break;
  }
  assert(header, "expected a shared Gloas block and state root");
  if (!manifest) return {header};

  const snapshots = [];
  for (const [index, client] of clients.entries()) {
    const state = `${client.api}/eth/v1/beacon/states/${header.state_root}`;
    const response = await fetch(`${state}/builders`, {
      body: JSON.stringify({ids: []}),
      headers: {"content-type": "application/json"},
      method: "POST",
      signal: AbortSignal.timeout(60_000),
    });
    assert(response.ok, `node ${index + 1}: builders HTTP ${response.status}`);
    const builders = (await response.json()).data;
    const pending = (await get(`${state}/pending_deposits`)).data;
    await writeFile(join(output, `node-${index + 1}-builders-at-fork.json`), `${JSON.stringify(builders)}\n`);
    await writeFile(join(output, `node-${index + 1}-pending-at-fork.json`), `${JSON.stringify(pending)}\n`);
    assert.equal(builders.length, manifest.outcomes.onboarded, `node ${index + 1}: builder count`);
    assert.equal(
      createHash("sha256")
        .update(JSON.stringify(builders.map((entry) => [entry.builder.pubkey, entry.builder.balance])))
        .digest("hex"),
      manifest.builderSequenceHash,
      `node ${index + 1}: all builder pubkeys, order and balances`
    );
    const byPubkey = new Map(builders.map((entry) => [entry.builder.pubkey, entry]));
    for (const expected of manifest.builders) {
      const actual = byPubkey.get(expected.pubkey);
      assert(actual, `node ${index + 1}: missing builder ${expected.pubkey}`);
      assert.equal(Number(actual.index), expected.index, `node ${index + 1}: builder index ${expected.pubkey}`);
      assert.equal(actual.builder.balance, expected.balance, `node ${index + 1}: builder balance ${expected.pubkey}`);
    }
    assert.equal(
      byPubkey.get(manifest.builders[0].pubkey).status,
      "active",
      `node ${index + 1}: builder A active at fork`
    );
    for (const pubkey of manifest.excludedPubkeys)
      assert(!byPubkey.has(pubkey), `node ${index + 1}: unexpected builder ${pubkey}`);
    assert.equal(pending.length, manifest.outcomes.kept, `node ${index + 1}: pending count`);
    const hash = createHash("sha256");
    for (const value of pending)
      hash.update(ssz.phase0.DepositData.hashTreeRoot(ssz.electra.PendingDeposit.fromJson(value)));
    assert.equal(
      hash.digest("hex"),
      manifest.remainingQueueHash,
      `node ${index + 1}: remaining queue contents and order`
    );
    const metrics = await get(client.metrics, false);
    for (const [outcome, expected] of Object.entries(manifest.outcomes)) {
      assert.equal(
        metric(metrics, "lodestar_stfn_gloas_onboard_builders_deposits", `outcome="${outcome}"`),
        expected,
        `node ${index + 1}: ${outcome}`
      );
    }
    snapshots.push({
      builderA: byPubkey.get(manifest.builders[0].pubkey),
      builders: builders.length,
      node: index + 1,
      pending: pending.length,
    });
  }
  await writeFile(join(output, "fork-snapshots.json"), `${JSON.stringify({header, snapshots}, null, 2)}\n`);
  return {header, snapshots};
}

while (Date.now() < deadline) {
  let observations;
  try {
    observations = await Promise.all(
      clients.map(async (client, index) => {
        const [head, finality, metrics] = await Promise.all([
          get(`${client.api}/eth/v1/beacon/headers/head`),
          get(`${client.api}/eth/v1/beacon/states/head/finality_checkpoints`),
          get(client.metrics, false),
        ]);
        await writeFile(join(output, `node-${index + 1}-latest.prom`), metrics);
        const current = {
          cacheHitsAtFork: metric(metrics, "lodestar_stfn_gloas_onboard_builders_signature_checks", 'source="cache"'),
          cached: metric(metrics, "lodestar_builder_deposit_preverify_cached_deposits"),
          finalizedEpoch: Number(finality.data.finalized.epoch),
          onboarding: metric(metrics, "lodestar_stfn_gloas_onboard_builders_seconds_sum"),
          onboardingRuns: metric(metrics, "lodestar_stfn_gloas_onboard_builders_seconds_count"),
          pending: metric(metrics, "lodestar_builder_deposit_preverify_pending_deposits"),
          slot: Number(head.data.header.message.slot),
          verifiedAtFork: metric(metrics, "lodestar_stfn_gloas_onboard_builders_signature_checks", 'source="verified"'),
        };
        for (const key of Object.keys(peak[index])) peak[index][key] = Math.max(peak[index][key], current[key]);
        const previousRun = forkChecks[index].at(-1)?.onboardingRuns ?? 0;
        if (current.onboardingRuns > previousRun) {
          assert.equal(
            current.onboardingRuns,
            previousRun + 1,
            `node ${index + 1}: missed an upgrade between scrapes; signature coverage is inconclusive`
          );
          if (manifest)
            assert.equal(
              current.cacheHitsAtFork + current.verifiedAtFork,
              expectedChecks,
              `node ${index + 1}: signature checks in upgrade ${current.onboardingRuns}`
            );
          if (index % 2 === 0 && !sharedHeader)
            assert.equal(current.verifiedAtFork, 0, `node ${index + 1}: uncached verification before fork capture`);
          forkChecks[index].push({...current});
          await writeFile(join(output, `node-${index + 1}-fork-${current.onboardingRuns}.prom`), metrics);
          if (previousRun === 0) await writeFile(join(output, `node-${index + 1}-fork.prom`), metrics);
        }
        return current;
      })
    );
  } catch (error) {
    if (error.code === "ERR_ASSERTION") throw error;
    await appendFile(
      join(output, "request-errors.jsonl"),
      `${JSON.stringify({error: String(error), time: new Date().toISOString()})}\n`
    );
    await setTimeout(10_000);
    continue;
  }
  await appendFile(
    join(output, "observations.jsonl"),
    `${JSON.stringify({observations, time: new Date().toISOString()})}\n`
  );
  console.log(
    JSON.stringify({
      finalized: observations.map((node) => node.finalizedEpoch),
      peak,
      slots: observations.map((node) => node.slot),
    })
  );
  if (!sharedHeader && manifest && observations.every((node) => node.slot >= forkSlot)) {
    const captured = await captureFork();
    sharedHeader = captured.header;
    forkSnapshots = captured.snapshots;
    console.log(
      JSON.stringify({nodes: forkSnapshots.length, phase: "fork-contents-verified", slot: sharedHeader.slot})
    );
  }
  if (observations.every((node) => node.finalizedEpoch >= forkEpoch)) {
    finalized = true;
    break;
  }
  await setTimeout(observations.some((node) => node.slot >= forkSlot - 2 && node.slot <= forkSlot + 2) ? 1000 : 10_000);
}
assert(finalized, "all nodes must finalize Gloas within 45 minutes");
sharedHeader ??= (await captureFork()).header;
const pass = peak.every((node, index) => {
  const first = forkChecks[index][0];
  return (
    first &&
    node.pending >= expectedPending &&
    (index % 2 === 1 || (first.cacheHitsAtFork >= expectedChecks && first.verifiedAtFork === 0))
  );
});
await writeFile(
  join(output, "result.json"),
  `${JSON.stringify({expectedDeposits: Number(count), forkChecks, forkEpoch, forkSnapshots, pass, peak, scenario: manifest?.scenario ?? "prefix", sharedHeader}, null, 2)}\n`
);
for (const [index, node] of peak.entries()) {
  assert(node.pending >= expectedPending, `node ${index + 1}: attack queue was not observed before the fork`);
  const first = forkChecks[index][0];
  assert(first, `node ${index + 1}: no fork transition was observed`);
  if (index % 2 === 1) continue;
  assert(first.cacheHitsAtFork >= expectedChecks, `node ${index + 1}: insufficient fork cache coverage`);
  assert.equal(first.verifiedAtFork, 0, `node ${index + 1}: uncached fork-time verification`);
}
