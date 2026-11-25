// Judges one consensus client interop run while the enclave is still up. Inputs come from run.sh through the
// environment, the verdict goes to stdout, result.json and summary.md in OUT_DIR, and the exit code is 1 on any failure.
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {knownIssues} from "./known-issues.mjs";

const env = (name) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`missing env ${name}`);
  return value;
};
const CLIENT = env("CLIENT");
const BN_TYPE = env("BN_TYPE");
const VC_TYPE = env("VC_TYPE");
const BN_IMAGE = env("BN_IMAGE");
const VC_IMAGE = env("VC_IMAGE");
const SCENARIO = env("SCENARIO");
const OUT_DIR = env("OUT_DIR");
const shortDigest = (d) => (d ? ` ${d.slice(7, 19)}` : "");
const LODESTAR = `${process.env.LODESTAR_IMAGE ?? ""}${shortDigest(process.env.LODESTAR_DIGEST)} ${process.env.LODESTAR_VERSION ?? ""}`.trim();
const BN_DIGEST = shortDigest(process.env.BN_DIGEST).trim();
const VC_DIGEST = shortDigest(process.env.VC_DIGEST).trim();
const EL = `${process.env.EL_IMAGE ?? ""}${shortDigest(process.env.EL_DIGEST)}`.trim();

const SLOTS_PER_EPOCH = 8;
const VALIDATORS_PER_NODE = 64;
const SYNC_COMMITTEE_SIZE = 32;
const PTC_SIZE = 16;
const GLOAS_FORK_EPOCH = 2;
const TIMELY_TARGET_FLAG = 1 << 1;
const TIMELY_HEAD_FLAG = 1 << 2;
// everything before this is startup noise, validator clients still pick up their first duties in epoch 1
const FIRST_JUDGED_EPOCH = 2;
const FIRST_JUDGED_SLOT = FIRST_JUDGED_EPOCH * SLOTS_PER_EPOCH;
// a committee filling fewer of its seats in a block means one side stopped delivering
const MIN_COMMITTEE_SHARE = 0.75;
// head votes are lost to late blocks and stale attestation data, a pair below this over the judged epochs is a failure
const MIN_HEAD_SHARE = 0.9;
// the bootnode has no validators, node 2 holds the first 64 and node 3 the next 64
const PAIR = [`${BN_TYPE} bn + lodestar vc`, `lodestar bn + ${VC_TYPE} vc`];
const nodeOf = (validatorIndex) => Math.floor(validatorIndex / VALIDATORS_PER_NODE);

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const pct = (share) => `${Math.round(share * 100)}%`;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

const read = (file) => readFileSync(path.join(OUT_DIR, file), "utf8");
const readOptional = (file) => {
  try {
    return read(file);
  } catch {
    return null;
  }
};

// a failure with a known cause is reported with its note and does not fail the run, see known-issues.mjs
const matchesKnownIssue = (failure, issue) =>
  issue.client === CLIENT &&
  issue.failure.test(failure) &&
  (issue.evidence === undefined || issue.evidence[1].test(readOptional(issue.evidence[0]) ?? ""));
const classify = (all) => {
  const failures = [];
  const known = [];
  for (const failure of all) {
    const issue = knownIssues.find((candidate) => matchesKnownIssue(failure, candidate));
    if (issue) known.push(`known issue: ${failure} (${issue.note}${issue.issue ? `, ${issue.issue}` : ""})`);
    else failures.push(failure);
  }
  return {failures, known};
};
const verdictOf = (failures, known) => (failures.length > 0 ? "fail" : known.length > 0 ? "known issues" : "pass");
const RESULT = {pass: "✅ pass", "known issues": "⚠️ known issues", fail: "❌ fail"};
const writeSummaryRow = (bn, vc, verdict, lines) =>
  writeFileSync(
    path.join(OUT_DIR, "summary.md"),
    `| ${CLIENT} | ${bn} | ${vc} | ${SCENARIO} | ${RESULT[verdict]} | ${lines.join("<br>").replace(/\\/g, "\\\\").replace(/\|/g, "\\|")} |\n`
  );

// run.sh hands over the reason when the run aborted before the verdict, the row then carries only that reason. A
// Lodestar container that is not running is a failure of its own, no other client's known issue can cover it
if (process.env.ABORT_REASON !== undefined) {
  const reason = process.env.ABORT_REASON.trim();
  const lodestarDown = [...reason.matchAll(/\b(lodestar (?:bn|vc)) (exited[^,)]*|dead|gone|restarting|paused)/g)].map(
    ([, who, state]) => `${who} ${state}`
  );
  const {failures, known} = classify([reason, ...lodestarDown]);
  const verdict = verdictOf(failures, known);
  writeSummaryRow(`\`${BN_IMAGE}\` ${BN_DIGEST}`, `\`${VC_IMAGE}\` ${VC_DIGEST}`, verdict, [...failures, ...known]);
  console.log(`${verdict.toUpperCase()} ${CLIENT}/${SCENARIO}: ${[...failures, ...known].join("; ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

// node 3, the Lodestar beacon node driving the other validator client
const API_LS = env("API_LS");
// node 2, the other beacon node driving the Lodestar validator client
const API_X = env("API_X");
const LS_PEER_ID = env("LS_PEER_ID");
const X_PEER_ID = env("X_PEER_ID");

function parseMetrics(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const idx = line.lastIndexOf(" ");
    out.set(line.slice(0, idx), Number(line.slice(idx + 1)));
  }
  return out;
}
const metric = (m, prefix) => [...m.entries()].filter(([k]) => k === prefix || k.startsWith(`${prefix}{`));
const sum = (entries) => entries.reduce((a, [, v]) => a + v, 0);
const delta = (before, after, prefix) => sum(metric(after, prefix)) - sum(metric(before, prefix));
// counter increase per label set, a label set that only appears after started at zero
const deltaByLabel = (before, after, prefix) => {
  const out = [];
  for (const [key, value] of metric(after, prefix)) {
    const d = value - (before.get(key) ?? 0);
    if (d > 0) out.push([key.slice(prefix.length) || "{}", d]);
  }
  return out;
};
const describe = (entries) =>
  entries
    .map(([labels, d]) => `${labels.replace(/^\{|\}$/g, "").replace(/\w+="([^"]*)"/g, "$1").replace(/,/g, " ") || "total"} ${d}`)
    .join(", ");
const total = (entries) => entries.reduce((a, [, d]) => a + d, 0);
const popcount = (hex) => {
  let n = 0;
  for (const byte of Buffer.from(hex.replace(/^0x/, ""), "hex")) n += byte.toString(2).replace(/0/g, "").length;
  return n;
};

async function beacon(port, route) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${route}`, {headers: {accept: "application/json"}});
  } catch (e) {
    return {status: 0, body: null, error: e instanceof Error ? e.message : String(e)};
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return {status: res.status, body: res.status === 200 ? body : null, error: res.status === 200 ? null : body};
}

// metrics snapshots taken by run.sh: the Lodestar beacon node of node 3, the Lodestar validator client of node 2 and,
// when node 2 is Lodestar on both sides, its beacon node as well
const snap = (name, who) => parseMetrics(read(`metrics-${name}-${who}.txt`));
const hasLodestarXBn = readOptional("metrics-end-xbn.txt") !== null;
const startTime = read("snapshot-start.time").trim();

function judgeBeaconNode(who, before, after) {
  const counters = [
    ["lodestar_gossip_validation_reject_total", "gossip messages rejected"],
    ["beacon_reqresp_incoming_requests_error_total", "incoming req/resp errors"],
    ["beacon_reqresp_outgoing_requests_error_total", "outgoing req/resp errors"],
    ["lodestar_peer_disconnected_total", "peer disconnects"],
    ["lodestar_peer_goodbye_received_total", "goodbyes received"],
    ["lodestar_peer_goodbye_sent_total", "goodbyes sent"],
    ["lodestar_gossip_block_process_block_errors", "block processing errors"],
  ];
  for (const [name, text] of counters) {
    const d = deltaByLabel(before, after, name);
    if (d.length > 0) fail(`${who}: ${total(d)} ${text} (${describe(d)})`);
  }
  // the error counter carries the reason of every ignore and reject
  const ignored = deltaByLabel(before, after, "lodestar_gossip_validation_ignore_total");
  const reasons = deltaByLabel(before, after, "lodestar_gossip_validation_error_total");
  if (ignored.length > 0) notes.push(`${who}: ${total(ignored)} gossip messages ignored (${describe(reasons)})`);
}

function judgeValidatorClient(who, before, after) {
  const requestErrors = deltaByLabel(before, after, "vc_rest_api_client_request_errors_total");
  if (requestErrors.length > 0) fail(`${who}: ${total(requestErrors)} beacon node request errors (${describe(requestErrors)})`);
  const counters = [
    ["vc_attestation_service_errors", "attestation errors"],
    ["vc_ptc_service_errors", "payload attestation errors"],
    ["vc_block_proposing_errors_total", "block proposal errors"],
    ["vc_payload_envelope_proposing_errors_total", "payload envelope errors"],
    ["vc_sign_errors_total", "signing errors"],
    ["vc_remote_sign_errors_total", "remote signing errors"],
    ["vc_slashing_protection_block_errors_total", "slashing protection block errors"],
    ["vc_slashing_protection_attestation_errors_total", "slashing protection attestation errors"],
  ];
  for (const [name, text] of counters) {
    const d = deltaByLabel(before, after, name);
    if (d.length > 0) fail(`${who}: ${total(d)} ${text} (${describe(d)})`);
  }
  const published = [
    ["vc_published_attestations_total", "attestations", fail],
    ["vc_published_aggregates_total", "aggregates", fail],
    ["vc_published_sync_committee_message_total", "sync committee messages", fail],
    ["vc_published_sync_committee_contribution_total", "sync committee contributions", (m) => notes.push(m)],
    ["vc_block_published_total", "blocks", (m) => notes.push(m)],
  ];
  if (SCENARIO === "gloas") published.push(["vc_published_payload_attestations_total", "payload attestations", fail]);
  for (const [name, text, report] of published) {
    if (delta(before, after, name) === 0) report(`${who}: published no ${text}`);
  }
  const health = sum(metric(after, "vc_beacon_health"));
  if (health !== 0) fail(`${who}: beacon health ${health} at the end (0 ready, 1 syncing, 2 error)`);
}

// request and error deltas after the first finalized epoch
judgeBeaconNode("lodestar bn (node 3)", snap("start", "lsbn"), snap("end", "lsbn"));
if (hasLodestarXBn) judgeBeaconNode("lodestar bn (node 2)", snap("start", "xbn"), snap("end", "xbn"));
judgeValidatorClient("lodestar vc (node 2)", snap("start", "lsvc"), snap("end", "lsvc"));
const peerClients = metric(snap("end", "lsbn"), "lodestar_peers_by_client_count")
  .filter(([, v]) => v > 0)
  .map(([k]) => k.match(/client="([^"]*)"/)?.[1])
  .filter(Boolean)
  .join(",");

// Lodestar log lines after the judged window starts
// docker -t prefixes RFC3339 nanosecond timestamps, compare on millisecond precision
const ms = (iso) => iso.slice(0, 23);
const judgedLines = (file) =>
  read(file)
    .split("\n")
    .filter((line) => ms(line) >= ms(startTime))
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\S+ /, ""));
// every REST response of a Lodestar beacon node with an error status, by route and status, the rest module logs
// them at debug level
const apiErrorsOf = (file, who) => {
  const counts = new Map();
  for (const text of judgedLines(file)) {
    const m = text.match(/\[rest\]\s+debug: Res req-\S+ (\S+) - ([45]\d\d)$/);
    if (!m) continue;
    const key = `${m[1]} ${m[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const n = [...counts.values()].reduce((a, b) => a + b, 0);
    fail(`${who}: ${n} REST API error responses (${[...counts].map(([k, v]) => `${k} x${v}`).join(", ")})`);
  }
};
// the beacon node warns about things a small devnet cannot avoid, only its errors are judged, the validator client is
// judged on warnings too
const lodestarLogFailures = (file, who, levels) => {
  const counts = new Map();
  for (const text of judgedLines(file)) {
    const m = text.match(/\b(warn|error): (.*)$/);
    if (!m || !levels.includes(m[1])) continue;
    // the message ends where the structured fields start, request ids would make every request its own line
    const key = `${m[1]}: ${m[2].replace(/ \S+=.*$/, "").replace(/\breq-\w+/, "req-*").trim()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of counts) fail(`${who} log: ${key}${n > 1 ? ` (x${n})` : ""}`);
};
apiErrorsOf("bn3-lodestar.log", "lodestar bn (node 3)");
lodestarLogFailures("bn3-lodestar.log", "lodestar bn (node 3)", ["error"]);
lodestarLogFailures("vc2-lodestar.log", "lodestar vc (node 2)", ["warn", "error"]);
if (hasLodestarXBn) {
  apiErrorsOf("bn2-lodestar.log", "lodestar bn (node 2)");
  lodestarLogFailures("bn2-lodestar.log", "lodestar bn (node 2)", ["error"]);
}

// the chain as the Lodestar beacon node sees it and the cross-node checks need both nodes to answer, a node that goes
// away during the verdict costs one failure line instead of the row
let head = -1;
let finalized = -1;
let finalityLs = null;
let versionX = "";
let envelopes = "";
const proposals = [0, 0];
const blobBlocks = [0, 0];
let blobs = 0;
const missed = [];
const syncShares = [];
const ptcShares = [];
const judgedEpochs = [];
const targetMisses = [];
const headMisses = [0, 0];
try {
  // chain progress as the Lodestar beacon node sees it: missed slots with their proposer's pair, blocks and blobs per
  // node, sync committee and payload timeliness committee seats filled per block
  const headRes = await beacon(API_LS, "/eth/v1/beacon/headers/head");
  const finalityRes = await beacon(API_LS, "/eth/v1/beacon/states/head/finality_checkpoints");
  if (headRes.status !== 200 || finalityRes.status !== 200) {
    throw new Error(`lodestar bn: headers/head ${headRes.status}, finality_checkpoints ${finalityRes.status}`);
  }
  head = Number(headRes.body.data.header.message.slot);
  finalityLs = finalityRes.body.data.finalized;
  finalized = Number(finalityLs.epoch);
  const proposerOf = new Map();
  for (let epoch = 0; epoch <= Math.floor(head / SLOTS_PER_EPOCH); epoch++) {
    const duties = await beacon(API_LS, `/eth/v1/validator/duties/proposer/${epoch}`);
    for (const duty of duties.body?.data ?? []) proposerOf.set(Number(duty.slot), Number(duty.validator_index));
  }
  const slotOfRoot = new Map();
  const gloasBlockSlots = [];
  for (let slot = 1; slot <= head; slot++) {
    const judged = slot >= FIRST_JUDGED_SLOT;
    const header = await beacon(API_LS, `/eth/v1/beacon/headers/${slot}`);
    if (header.status !== 200) {
      if (judged) missed.push(slot);
      continue;
    }
    slotOfRoot.set(header.body.data.root, slot);
    const block = await beacon(API_LS, `/eth/v2/beacon/blocks/${slot}`);
    if (block.status !== 200) {
      fail(`lodestar bn: block at slot ${slot} returned ${block.status}`);
      continue;
    }
    const message = block.body.data.message;
    const node = nodeOf(Number(message.proposer_index));
    proposals[node]++;
    const bid = message.body.signed_execution_payload_bid;
    const commitments = bid ? bid.message.blob_kzg_commitments : (message.body.blob_kzg_commitments ?? []);
    blobs += commitments.length;
    if (commitments.length > 0) blobBlocks[node]++;
    if (judged) syncShares.push([slot, popcount(message.body.sync_aggregate.sync_committee_bits) / SYNC_COMMITTEE_SIZE]);
    if (bid) {
      gloasBlockSlots.push(slot);
      // the payload attestations in a block vote on the parent's payload, judged when the parent is the previous slot
      const parentSlot = slotOfRoot.get(message.parent_root);
      if (judged && parentSlot === slot - 1 && parentSlot >= GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH) {
        const seats = message.body.payload_attestations
          .filter((a) => a.data.beacon_block_root === message.parent_root && a.data.payload_present)
          .reduce((n, a) => n + popcount(a.aggregation_bits), 0);
        ptcShares.push([slot, seats / PTC_SIZE]);
      }
    }
  }
  if (missed.length > 0) {
    const who = (slot) => (proposerOf.has(slot) ? ` (${PAIR[nodeOf(proposerOf.get(slot))]})` : "");
    fail(`missed slots after the first epoch: ${missed.map((slot) => `${slot}${who(slot)}`).join(", ")}`);
  }
  for (const [n, label] of [[0, PAIR[0]], [1, PAIR[1]]]) {
    if (proposals[n] === 0) fail(`no block proposed by ${label}`);
  }
  if (blobs === 0) fail("no blob was included, the spammer did not run");
  const lowSync = syncShares.filter(([, share]) => share < MIN_COMMITTEE_SHARE);
  if (lowSync.length > 0) {
    fail(`sync aggregate below ${pct(MIN_COMMITTEE_SHARE)} of the committee in slots ${lowSync.map(([slot, share]) => `${slot} (${pct(share)})`).join(", ")}`);
  }
  const lowPtc = ptcShares.filter(([, share]) => share < MIN_COMMITTEE_SHARE);
  if (lowPtc.length > 0) {
    fail(`payload attestations below ${pct(MIN_COMMITTEE_SHARE)} of the committee in slots ${lowPtc.map(([slot, share]) => `${slot} (${pct(share)})`).join(", ")}`);
  }

  // attestation participation per validator from the state at the end of the following epoch, every validator of both
  // nodes has to hit the target in every judged epoch
  const participationFlags = (value) =>
    Array.isArray(value) ? value.map(Number) : [...Buffer.from(String(value).replace(/^0x/, ""), "hex")];
  const lastJudgedEpoch = Math.floor((head + 1) / SLOTS_PER_EPOCH) - 2;
  for (let epoch = FIRST_JUDGED_EPOCH; epoch <= lastJudgedEpoch; epoch++) {
    const slot = (epoch + 2) * SLOTS_PER_EPOCH - 1;
    const state = await beacon(API_LS, `/eth/v2/debug/beacon/states/${slot}`);
    if (state.status !== 200) {
      fail(`lodestar bn: state at slot ${slot} not available (${state.status}), participation of epoch ${epoch} not judged`);
      continue;
    }
    judgedEpochs.push(epoch);
    const missedTarget = [];
    participationFlags(state.body.data.previous_epoch_participation).forEach((flags, index) => {
      if (!(flags & TIMELY_TARGET_FLAG)) missedTarget.push(index);
      if (!(flags & TIMELY_HEAD_FLAG)) headMisses[nodeOf(index)]++;
    });
    if (missedTarget.length > 0) targetMisses.push([epoch, missedTarget]);
  }
  for (const [epoch, indices] of targetMisses) {
    const byNode = [0, 1]
      .map((n) => [n, indices.filter((i) => nodeOf(i) === n)])
      .filter(([, ids]) => ids.length > 0)
      .map(([n, ids]) => `${ids.length} on ${PAIR[n]}: ${ids.slice(0, 8).join(",")}${ids.length > 8 ? ",…" : ""}`);
    fail(`epoch ${epoch}: ${indices.length} validators missed the target (${byNode.join("; ")})`);
  }
  const attestations = judgedEpochs.length * VALIDATORS_PER_NODE;
  for (const n of [0, 1]) {
    const share = attestations > 0 ? 1 - headMisses[n] / attestations : 1;
    if (share < MIN_HEAD_SHARE) fail(`${PAIR[n]}: ${pct(share)} of the attestations in the judged epochs hit the head`);
  }

  // the other beacon node has to agree with the Lodestar one and the two have to be connected to each other
  const finalityX = await beacon(API_X, "/eth/v1/beacon/states/head/finality_checkpoints");
  if (finalityX.status !== 200) {
    fail(`${BN_TYPE} bn: finality checkpoints returned ${finalityX.status}`);
  } else if (finalityX.body.data.finalized.root !== finalityLs.root || Number(finalityX.body.data.finalized.epoch) !== finalized) {
    fail(`nodes disagree on finality: lodestar bn ${finalized} ${finalityLs.root.slice(0, 10)}, ${BN_TYPE} bn ${finalityX.body.data.finalized.epoch} ${finalityX.body.data.finalized.root.slice(0, 10)}`);
  }
  const headX = await beacon(API_X, "/eth/v1/beacon/headers/head");
  const headSlotX = Number(headX.body?.data.header.message.slot ?? -1);
  if (Math.abs(headSlotX - head) > 1) fail(`heads apart: lodestar bn at slot ${head}, ${BN_TYPE} bn at slot ${headSlotX}`);
  const syncingX = await beacon(API_X, "/eth/v1/node/syncing");
  if (syncingX.body?.data.is_syncing !== false) fail(`${BN_TYPE} bn reports syncing at the end`);
  for (const [api, name, peerId, peerName] of [
    [API_LS, "lodestar bn (node 3)", X_PEER_ID, `${BN_TYPE} bn`],
    [API_X, `${BN_TYPE} bn (node 2)`, LS_PEER_ID, "lodestar bn"],
  ]) {
    const peers = await beacon(api, "/eth/v1/node/peers?state=connected");
    const connected = peers.body?.data ?? [];
    if (!connected.some((p) => p.peer_id === peerId)) fail(`${name} is not connected to ${peerName} at the end (${connected.length} peers)`);
  }
  versionX = (await beacon(API_X, "/eth/v1/node/version")).body?.data.version ?? "";

  // gloas: the fork happened on both nodes and the Lodestar node serves every archived envelope
  if (SCENARIO === "gloas") {
    const spec = (await beacon(API_LS, "/eth/v1/config/spec")).body.data;
    for (const [api, name] of [[API_LS, "lodestar bn"], [API_X, `${BN_TYPE} bn`]]) {
      const fork = await beacon(api, "/eth/v1/beacon/states/head/fork");
      const version = fork.body?.data.current_version;
      if (version !== spec.GLOAS_FORK_VERSION) fail(`${name}: head fork version ${version} is not gloas ${spec.GLOAS_FORK_VERSION}`);
    }
    if (finalized <= GLOAS_FORK_EPOCH) fail(`finalized epoch ${finalized} does not cover gloas slots`);
    // the newest envelope may still be in flight
    const slots = gloasBlockSlots.filter((slot) => slot < head);
    const served = [0, 0];
    const statusesX = new Set();
    for (const slot of slots) {
      const [resLs, resX] = await Promise.all(
        [API_LS, API_X].map((api) =>
          fetch(`http://127.0.0.1:${api}/eth/v1/beacon/execution_payload_envelopes/${slot}`, {headers: {accept: "application/octet-stream"}}).then(
            async (res) => ({status: res.status, bytes: (await res.arrayBuffer()).byteLength})
          )
        )
      );
      if (resLs.status === 200 && resLs.bytes >= 400) served[0]++;
      else fail(`lodestar bn: envelope for slot ${slot}: status ${resLs.status}, ${resLs.bytes} bytes`);
      if (resX.status === 200 && resX.bytes >= 400) served[1]++;
      else if (hasLodestarXBn) fail(`lodestar bn (node 2): envelope for slot ${slot}: status ${resX.status}, ${resX.bytes} bytes`);
      else statusesX.add(resX.status);
    }
    envelopes = `envelopes served ${served[0]}/${slots.length} by lodestar bn, ${served[1]}/${slots.length} by ${BN_TYPE} bn${statusesX.size > 0 ? ` (${[...statusesX].join(",")})` : ""}`;
  }
} catch (e) {
  fail(`checks stopped early: ${e instanceof Error ? e.message : String(e)}`);
}

const {failures: unresolved, known} = classify(failures);
const verdict = verdictOf(unresolved, known);
const result = {
  client: CLIENT,
  bnType: BN_TYPE,
  bnImage: BN_IMAGE,
  bnDigest: process.env.BN_DIGEST ?? "",
  bnVersion: versionX,
  vcImage: VC_IMAGE,
  vcDigest: process.env.VC_DIGEST ?? "",
  lodestar: LODESTAR,
  el: EL,
  scenario: SCENARIO,
  verdict,
  finalized,
  head,
  proposals,
  blobs,
  blobBlocks,
  missed,
  judgedEpochs,
  targetMisses,
  headMisses,
  syncShares,
  ptcShares,
  peerClients,
  envelopes,
  failures: unresolved,
  known,
  notes,
};
writeFileSync(path.join(OUT_DIR, "result.json"), JSON.stringify(result, null, 2));

const shares = (label, values) =>
  values.length > 0 ? `${label} ${pct(mean(values.map(([, s]) => s)))} avg, ${pct(Math.min(...values.map(([, s]) => s)))} min over ${values.length} blocks` : "";
const details = [
  `lodestar ${LODESTAR}; ${BN_TYPE} bn ${versionX}; el ${EL}`,
  `finality ${finalized}, head ${head}, blocks ${proposals[0]}/${proposals[1]}, ${blobs} blobs in ${blobBlocks[0]}/${blobBlocks[1]} blocks (node 2/node 3)`,
  judgedEpochs.length > 0
    ? `participation judged in epochs ${judgedEpochs.join(",")}: ${targetMisses.reduce((n, [, ids]) => n + ids.length, 0)} target misses, ${headMisses[0]}/${headMisses[1]} head misses`
    : "no epoch judged for participation",
  shares("sync committee seats", syncShares),
  shares("payload attestation seats", ptcShares),
  envelopes,
  peerClients ? `peers seen as ${peerClients}` : "",
  ...notes,
]
  .filter(Boolean)
  .join("; ");
writeSummaryRow(`\`${BN_IMAGE}\` ${BN_DIGEST} ${versionX}`, `\`${VC_IMAGE}\` ${VC_DIGEST}`, verdict, [...unresolved, ...known, details]);

console.log(`${verdict.toUpperCase()} ${CLIENT}/${SCENARIO}: ${details}`);
for (const line of [...unresolved, ...known]) console.log(`  - ${line}`);
process.exit(unresolved.length === 0 ? 0 : 1);
