// Manual transport benchmark, not operational builder code. Build builder and CLI first.
// node packages/cli/test/perf/bidResponseTiming.mjs > timing.json
// Uses actual authenticated HTTP routes and complete response bodies on loopback.
// Delays model queues/transport; they do not measure a real proposer's return path.
import assert from "node:assert/strict";
import http from "node:http";
import {setTimeout as sleep} from "node:timers/promises";
import {SecretKey} from "@lodestar/native/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {DOMAIN_BUILDER_REQUEST_AUTH, ForkName} from "@lodestar/params";
import {ZERO_HASH, computeDomain, computeSigningRoot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getBuilderApi} from "../../../builder/lib/api/impl.js";
import {BidStore} from "../../../builder/lib/services/bidStore.js";
import {BuilderRestApiServer} from "../../lib/cmds/builder/apiServer.js";

const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 0xaa));
const slot = 3;
const authData = new TextEncoder().encode("timing.local");
const proposerKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
const proposerPubkey = proposerKey.toPublicKey().toBytes();
const authMessage = {slot, data: authData};
const domain = computeDomain(DOMAIN_BUILDER_REQUEST_AUTH, config.GENESIS_FORK_VERSION, ZERO_HASH);
const auth = {
  message: authMessage,
  signature: proposerKey.sign(computeSigningRoot(ssz.gloas.BuilderRequestAuth, authMessage, domain)).toBytes(),
};
const body = JSON.stringify(ssz.gloas.SignedBuilderRequestAuth.toJson(auth));
const root = `0x${"04".repeat(32)}`;
const path = `/eth/v1/builder/execution_payload_bid/${slot}/${root}/${root}/0x${Buffer.from(proposerPubkey).toString("hex")}`;
const clock = {getCurrentSlot: () => slot, msToSlot: () => 0, secFromSlot: () => 0};
const logger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  verbose() {},
  child() {
    return this;
  },
};

function candidate(value) {
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  Object.assign(bid.message, {
    slot,
    builderIndex: 1,
    value,
    parentBlockHash: Buffer.alloc(32, 4),
    parentBlockRoot: Buffer.alloc(32, 4),
    blockHash: Buffer.alloc(32, value),
  });
  return bid;
}

async function trial(mode, scenario) {
  const bidStore = new BidStore();
  bidStore.add(candidate(5));
  const messages = [];
  const api = getBuilderApi(
    {
      config,
      logger: {
        ...logger,
        info(message, context) {
          messages.push({message, context});
        },
      },
      clock,
      api: {},
      bidStore,
      proposerDutiesTracker: {getProposer: async () => ({pubkey: proposerPubkey, validatorIndex: 7})},
      builderIndex: 1,
      metrics: null,
    },
    {
      authData,
      ...(mode === "cap60" ? {httpReturnReserveCapMs: 60} : {}),
      ...(mode === "margin20" ? {httpResponseMarginMs: 20} : {}),
    }
  );
  if (mode === "edgeReplacement") {
    const original = api.getExecutionPayloadBid;
    // Emulate PR25: the edge timestamp is taken after the queued client leg, then backdated by 25 ms.
    api.getExecutionPayloadBid = (args, context) =>
      original(
        {
          ...args,
          dateMilliseconds: Date.now() - scenario.edgeToOriginMs - 25,
        },
        context
      );
  }
  const origin = new BuilderRestApiServer({port: 0}, {config, logger, api, metrics: null});
  if (scenario.serverCompletionDelayMs) {
    origin.server.addHook("onSend", async (_request, _reply, payload) => {
      // A controlled server-side scheduling/completion delay after the bid was chosen.
      await sleep(scenario.serverCompletionDelayMs);
      return payload;
    });
  }
  await origin.listen();
  const originPort = origin.server.server.address().port;
  const proxy = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    await sleep(scenario.preEdgeMs + scenario.edgeToOriginMs);
    const upstream = http.request(
      {hostname: "127.0.0.1", port: originPort, path, method: "POST", headers: request.headers, agent: false},
      async (reply) => {
        const chunks = [];
        for await (const chunk of reply) chunks.push(chunk);
        await sleep(scenario.returnMs + (scenario.processingMs ?? 0));
        response.writeHead(reply.statusCode, reply.headers);
        response.end(Buffer.concat(chunks));
      }
    );
    upstream.on("error", () => response.destroy());
    upstream.end(Buffer.concat(chunks));
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const started = performance.now();
  const stamp = Date.now();
  const update = setTimeout(() => bidStore.add(candidate(10)), scenario.revisionMs);
  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (record) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({...record, elapsedMs: performance.now() - started});
    };
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: proxy.address().port,
        path,
        method: "POST",
        agent: false,
        headers: {
          "content-type": "application/json",
          "Eth-Consensus-Version": "gloas",
          "Date-Milliseconds": String(stamp + (scenario.clientClockAheadMs ?? 0)),
          "X-Timeout-Ms": String(scenario.timeoutMs),
        },
      },
      async (response) => {
        const chunks = [];
        try {
          for await (const chunk of response) chunks.push(chunk);
          const decoded = JSON.parse(Buffer.concat(chunks).toString());
          finish({status: response.statusCode, timeout: false, value: Number(decoded.data.message.value)});
        } catch {
          finish({timeout: false, error: "incomplete_response"});
        }
      }
    );
    const deadline = setTimeout(() => {
      finish({timeout: true});
      request.destroy();
    }, scenario.timeoutMs);
    request.on("error", () => finish({timeout: false, error: "transport_error"}));
    request.end(body);
  });
  clearTimeout(update);
  await sleep(
    Math.max(
      0,
      scenario.preEdgeMs + scenario.edgeToOriginMs + scenario.returnMs + scenario.timeoutMs - result.elapsedMs
    )
  );
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  await origin.close();
  return {
    mode,
    scenario: scenario.name,
    ...result,
    clientSlackMs: scenario.timeoutMs - result.elapsedMs,
    served: messages.find(({message}) => message === "Served execution payload bid")?.context,
  };
}

const scenarios = [
  {name: "queued_inbound", timeoutMs: 400, preEdgeMs: 150, edgeToOriginMs: 20, returnMs: 25, revisionMs: 250},
  {name: "cold_request", timeoutMs: 400, preEdgeMs: 200, edgeToOriginMs: 10, returnMs: 25, revisionMs: 250},
  {
    name: "slow_return_cap_is_unsafe",
    timeoutMs: 600,
    preEdgeMs: 160,
    edgeToOriginMs: 20,
    returnMs: 170,
    revisionMs: 420,
  },
];
const results = [];
for (const scenario of scenarios) {
  for (const mode of ["mirror", "cap60", "edgeReplacement"]) {
    results.push(await trial(mode, scenario));
  }
}
for (const name of ["queued_inbound", "cold_request"]) {
  const rows = results.filter((row) => row.scenario === name);
  assert.equal(rows[0].timeout, false);
  assert.equal(rows[0].value, 5);
  assert.equal(rows[1].timeout, false);
  assert.equal(rows[1].value, 10);
  assert.equal(rows[2].timeout, true);
}
const asymmetric = results.filter((row) => row.scenario === "slow_return_cap_is_unsafe");
assert.equal(asymmetric[0].timeout, false);
assert.equal(asymmetric[1].timeout, true);
for (const serverCompletionDelayMs of [0, 35]) {
  const scenario = {
    name: serverCompletionDelayMs ? "completion_delay_margin20_is_unsafe" : "margin20_quiet_server",
    timeoutMs: 400,
    preEdgeMs: 80,
    edgeToOriginMs: 20,
    returnMs: 100,
    revisionMs: 260,
    serverCompletionDelayMs,
  };
  const original = await trial("mirror", scenario);
  const reduced = await trial("margin20", scenario);
  results.push(original, reduced);
  assert.equal(original.timeout, false);
  assert.equal(original.value, 5);
  assert.equal(reduced.timeout, Boolean(serverCompletionDelayMs));
  if (!serverCompletionDelayMs) assert.equal(reduced.value, 10);
}
console.log(
  JSON.stringify(
    {benchmark: "authenticated-loopback-http-deadline", simulatedLatency: true, noProductionWinClaim: true, results},
    null,
    2
  )
);
