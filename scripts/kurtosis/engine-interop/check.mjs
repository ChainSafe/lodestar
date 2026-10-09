// Judges one engine-interop run while the enclave is still up. Inputs come from run.sh through the environment,
// the verdict goes to stdout, result.json and summary.md in OUT_DIR, and the exit code is 1 on any failure.
import crypto from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

const env = (name) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`missing env ${name}`);
  return value;
};
const EL_TYPE = env("EL_TYPE");
const EL_IMAGE = env("EL_IMAGE");
const SCENARIO = env("SCENARIO");
const OUT_DIR = env("OUT_DIR");
const JWT_SECRET = env("JWT_SECRET");
const API1 = env("API1");
const API2 = env("API2");
const METRICS1 = env("METRICS1");
const ENGINE1 = env("ENGINE1");
const RPC1 = env("RPC1");
const RESTART_SLOT = process.env.RESTART_SLOT || "";

const SLOTS_PER_EPOCH = 8;
const GLOAS_FORK_EPOCH = 2;
const ENVELOPE_SLOTS = [16, 17, 18, 19, 20];

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);

const read = (file) => readFileSync(path.join(OUT_DIR, file), "utf8");
const readOptional = (file) => {
  try {
    return read(file);
  } catch {
    return null;
  }
};

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
const delta = (before, after, prefix, filter = () => true) =>
  sum(metric(after, prefix).filter(([k]) => filter(k))) - sum(metric(before, prefix).filter(([k]) => filter(k)));
const label = (key, name) => key.match(new RegExp(`${name}="([^"]*)"`))?.[1];

async function beacon(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {headers: {accept: "application/json"}});
  return {status: res.status, body: res.status === 200 ? await res.json() : null};
}
async function metricsNow(port) {
  return parseMetrics(await (await fetch(`http://127.0.0.1:${port}/metrics`)).text());
}
function jwt() {
  const b64 = (b) => Buffer.from(b).toString("base64url");
  const header = b64(JSON.stringify({alg: "HS256", typ: "JWT"}));
  const payload = b64(JSON.stringify({iat: Math.floor(Date.now() / 1000)}));
  const secret = Buffer.from(JWT_SECRET.replace(/^0x/, ""), "hex");
  return `${header}.${payload}.${crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")}`;
}
async function engineGet(route) {
  const res = await fetch(`http://127.0.0.1:${ENGINE1}${route}`, {
    headers: {authorization: `Bearer ${jwt()}`, accept: "application/json"},
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {status: res.status, contentType: res.headers.get("content-type") ?? "", text: text.slice(0, 500), json};
}
async function engineRpc(method, params) {
  const res = await fetch(`http://127.0.0.1:${ENGINE1}`, {
    method: "POST",
    headers: {authorization: `Bearer ${jwt()}`, "content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  return (await res.json()).result;
}

// metrics snapshots taken by run.sh
const snap = (name, node) => parseMetrics(read(`metrics-${name}-cl${node}.txt`));
const start = [snap("start", 1), snap("start", 2)];
const end = [snap("end", 1), snap("end", 2)];
const startTime = read("snapshot-start.time").trim();
const restartTime = readOptional("restart.time")?.trim();
const restartSnapTime = readOptional("snapshot-restart.time")?.trim();

// identity of the EL, through REST when it has it and JSON-RPC otherwise
const capabilities = await engineGet("/engine/v1/capabilities");
const elHasRest = capabilities.status === 200 && capabilities.json !== null && Array.isArray(capabilities.json.supported_forks);
let elVersion = "";
if (elHasRest) {
  const identity = await engineGet("/engine/v1/identity");
  elVersion = identity.json?.map((v) => `${v.name} ${v.version} ${v.commit}`).join(", ") ?? "";
} else {
  try {
    const versions = await engineRpc("engine_getClientVersionV1", [
      {code: "LS", name: "Lodestar", version: "interop", commit: "0x00000000"},
    ]);
    elVersion = versions?.map((v) => `${v.name} ${v.version} ${v.commit}`).join(", ") ?? "";
  } catch {}
}

// transport Lodestar settled on, judged from its own request counter
const transportOf = (m) => {
  const ssz = sum(metric(m, "lodestar_execution_engine_api_requests_total").filter(([k]) => label(k, "transport") === "ssz"));
  const rpc = sum(metric(m, "lodestar_execution_engine_api_requests_total").filter(([k]) => label(k, "transport") === "json-rpc"));
  if (ssz === 0 && rpc === 0) return "json-rpc";
  return ssz > 0 ? "ssz" : "json-rpc";
};
const transports = [transportOf(end[0]), transportOf(end[1])];
if (transports[0] !== transports[1]) fail(`nodes settled on different transports: ${transports.join(" / ")}`);
const transport = transports[1];
if (elHasRest && transport !== "ssz") notes.push("EL advertises REST but Lodestar used JSON-RPC");
if (!elHasRest) notes.push(`capabilities probe: ${capabilities.status} ${capabilities.contentType}`);

// request deltas after the first finalized epoch, and again after the restart window
const windows = [["run", start, end]];
if (restartTime) windows.push(["after restart", [snap("restart", 1), snap("restart", 2)], [snap("after-restart", 1), snap("after-restart", 2)]]);
for (const [name, before, after] of windows) {
  for (const node of [0, 1]) {
    const who = `cl${node + 1} ${name}`;
    const b = before[node];
    const a = after[node];
    if (transport === "ssz") {
      const rpc = delta(b, a, "lodestar_execution_engine_api_requests_total", (k) => label(k, "transport") === "json-rpc");
      if (rpc > 0) fail(`${who}: ${rpc} requests fell back to JSON-RPC`);
    }
    const errors = delta(b, a, "lodestar_execution_engine_http_client_request_errors_total");
    if (errors > 0) fail(`${who}: ${errors} engine request errors`);
    const badPayloads = delta(b, a, "lodestar_execution_engine_notify_new_payload_result_total", (k) => label(k, "result") !== "VALID");
    if (badPayloads > 0) fail(`${who}: ${badPayloads} newPayload results other than VALID`);
    const badFcu = delta(b, a, "lodestar_execution_engine_notify_forkchoice_update_result_total", (k) => label(k, "result") !== "VALID");
    if (badFcu > 0) fail(`${who}: ${badFcu} forkchoiceUpdated results other than VALID`);
    const failedBlobs = delta(b, a, "lodestar_data_column_engine_result_total", (k) => label(k, "result") === "failed");
    if (failedBlobs > 0) fail(`${who}: ${failedBlobs} getBlobs calls failed`);
  }
}
const resolvedBlobs = sum(metric(end[1], "lodestar_data_column_engine_result_total").filter(([k]) => label(k, "result") === "success_resolved"));
if (resolvedBlobs === 0) notes.push("supernode never resolved blobs through the engine API");
const nullBlobs = sum(metric(end[0], "lodestar_data_column_engine_result_total").filter(([k]) => label(k, "result") === "null_response"));

// execution module log lines after the judged window starts, ignoring the restart itself
const logFailures = (file) => {
  const lines = read(file).split("\n");
  // docker -t prefixes RFC3339 nanosecond timestamps, compare on millisecond precision
  const ms = (iso) => iso.slice(0, 23);
  for (const line of lines) {
    const ts = ms(line);
    if (ts < ms(startTime)) continue;
    if (restartTime && restartSnapTime && ts >= ms(restartTime) && ts < ms(restartSnapTime)) continue;
    const text = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\S+ /, "");
    if (!text.includes("[execution]")) continue;
    if (/\berror: /.test(text) || /\bwarn: /.test(text) || /Using JSON-RPC for|rejected an advertised fork/.test(text)) {
      fail(`${file}: ${text.slice(0, 200)}`);
    }
  }
};
logFailures("cl1.log");
logFailures("cl2.log");

// chain progress: proposals per node, blobs per node, missed slots after the first epoch
const head = Number((await beacon(API2, "/eth/v1/beacon/headers/head")).body.data.header.message.slot);
const finalized = Number((await beacon(API2, "/eth/v1/beacon/states/head/finality_checkpoints")).body.data.finalized.epoch);
const proposals = [0, 0];
const blobBlocks = [0, 0];
let blobs = 0;
const missed = [];
for (let slot = 1; slot <= head; slot++) {
  const block = await beacon(API2, `/eth/v2/beacon/blocks/${slot}`);
  if (block.status !== 200) {
    if (slot >= SLOTS_PER_EPOCH) missed.push(slot);
    continue;
  }
  const message = block.body.data.message;
  const node = Math.floor(Number(message.proposer_index) / 64);
  proposals[node]++;
  const bid = message.body.signed_execution_payload_bid;
  const commitments = bid ? bid.message.blob_kzg_commitments : (message.body.blob_kzg_commitments ?? []);
  blobs += commitments.length;
  if (commitments.length > 0) blobBlocks[node]++;
}
if (missed.length > 0) fail(`missed slots after the first epoch: ${missed.join(",")}`);

// gloas: the fork happened and archived envelopes are rebuilt from EL bodies
let envelopes = "";
if (SCENARIO === "gloas") {
  const spec = (await beacon(API2, "/eth/v1/config/spec")).body.data;
  const fork = (await beacon(API2, "/eth/v1/beacon/states/head/fork")).body.data;
  if (fork.current_version !== spec.GLOAS_FORK_VERSION) fail(`head fork version ${fork.current_version} is not gloas`);
  if (finalized <= GLOAS_FORK_EPOCH) fail(`finalized epoch ${finalized} does not cover gloas slots`);
  const bodiesBefore = sum(metric(await metricsNow(METRICS1), "lodestar_execution_engine_http_client_request_time_seconds_count").filter(([k]) => label(k, "routeId") === "getPayloadBodiesByHash"));
  const sizes = [];
  for (const slot of ENVELOPE_SLOTS) {
    const res = await fetch(`http://127.0.0.1:${API1}/eth/v1/beacon/execution_payload_envelopes/${slot}`, {headers: {accept: "application/octet-stream"}});
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.status !== 200 || bytes.length < 400) fail(`envelope for slot ${slot}: status ${res.status}, ${bytes.length} bytes`);
    sizes.push(bytes.length);
  }
  const bodiesAfter = sum(metric(await metricsNow(METRICS1), "lodestar_execution_engine_http_client_request_time_seconds_count").filter(([k]) => label(k, "routeId") === "getPayloadBodiesByHash"));
  if (bodiesAfter - bodiesBefore === 0) fail("archived envelopes were served without asking the EL for bodies");
  envelopes = `${ENVELOPE_SLOTS.length} envelopes rebuilt (${bodiesAfter - bodiesBefore} bodies calls, ${Math.min(...sizes)}-${Math.max(...sizes)} bytes)`;
}

const verdict = failures.length === 0 ? "pass" : "fail";
const result = {
  el: EL_TYPE,
  image: EL_IMAGE,
  version: elVersion,
  scenario: SCENARIO,
  verdict,
  transport,
  elHasRest,
  capabilities: capabilities.json,
  finalized,
  head,
  proposals,
  blobs,
  blobBlocks,
  resolvedBlobs,
  nullBlobs,
  missed,
  restartSlot: RESTART_SLOT,
  envelopes,
  failures,
  notes,
};
writeFileSync(path.join(OUT_DIR, "result.json"), JSON.stringify(result, null, 2));

const details = [
  `finality ${finalized}, head ${head}, blocks ${proposals[0]}/${proposals[1]}, ${blobs} blobs in ${blobBlocks[0]}/${blobBlocks[1]} blocks`,
  `supernode resolved ${resolvedBlobs} getBlobs, non-supernode got ${nullBlobs} null`,
  RESTART_SLOT ? `EL restarted at slot ${RESTART_SLOT}` : "",
  envelopes,
  ...notes,
]
  .filter(Boolean)
  .join("; ");
const row = `| ${EL_TYPE} | \`${EL_IMAGE}\` ${elVersion} | ${SCENARIO} | ${elHasRest ? "yes" : "no"} | ${transport} | ${verdict === "pass" ? "✅ pass" : "❌ fail"} | ${[...failures, details].join("<br>")} |`;
writeFileSync(path.join(OUT_DIR, "summary.md"), `${row}\n`);

console.log(`${verdict.toUpperCase()} ${EL_TYPE}/${SCENARIO}: ${details}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
