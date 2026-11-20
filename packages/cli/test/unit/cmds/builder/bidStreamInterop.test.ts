import {ChildProcess, spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Mock, afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {DOMAIN_BUILDER_REQUEST_AUTH, ForkName} from "@lodestar/params";
import {
  ZERO_HASH,
  computeDomain,
  computeSigningRoot,
  getExecutionPayloadBidSigningRoot,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {fetch, toHex} from "@lodestar/utils";
import {BuilderBidStreamApi, getBuilderBidStreamApi} from "../../../../../builder/src/api/bidStream.js";
import {BuilderApi, BuilderApiModules, getBuilderApi} from "../../../../../builder/src/api/impl.js";
import {BidStore} from "../../../../../builder/src/services/bidStore.js";
import {ProposerDutiesTracker} from "../../../../../builder/src/services/proposerDutiesTracker.js";
import {getApiClientStub, mockApiResponse} from "../../../../../builder/test/unit/utils/apiStub.js";
import {ClockMock} from "../../../../../builder/test/unit/utils/clock.js";
import {BuilderRestApiServer} from "../../../../src/cmds/builder/apiServer.js";
import {testLogger} from "../../../utils.js";

const binary = process.env.COMMIT_BOOST_INTEROP_BINARY;
const slot = 255;
const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 1));
const proposerKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
const proposerPubkey = proposerKey.toPublicKey().toBytes();
const builderKey = SecretKey.fromBytes(Buffer.alloc(32, 3));
const parentHash = Buffer.alloc(32, 3);
const parentRoot = Buffer.alloc(32, 4);
const authData = new TextEncoder().encode("127.0.0.1");
const requestPath = `/eth/v1/builder/execution_payload_bid/${slot}/${toHex(parentHash)}/${toHex(parentRoot)}/${toHex(proposerPubkey)}`;

class InteropServer extends BuilderRestApiServer {
  get port(): number {
    return this.server.addresses()[0].port;
  }
}

// Opt in with the locally installed, pinned v0.12.0-rc1 release binary. All peers and keys are fixtures.
describe.skipIf(!binary).each([false, true])("Commit-Boost Gloas stream, adaptive timing %s", (adaptiveTiming) => {
  let server: InteropServer | undefined;
  let child: ChildProcess | undefined;
  let directory: string | undefined;
  let endpoint: string;
  let bidStore: BidStore;
  let output = "";
  let controller: AbortController;
  let httpBid: Mock<BuilderApi["getExecutionPayloadBid"]>;
  let streamOpen: Mock<BuilderBidStreamApi["open"]>;

  afterEach(async () => {
    controller?.abort();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child?.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child?.kill("SIGKILL"), 2000);
      await exited;
      clearTimeout(timer);
    }
    await server?.close();
    if (directory) await rm(directory, {recursive: true, force: true});
    child = undefined;
    server = undefined;
  });

  function bid(value: number): gloas.SignedExecutionPayloadBid {
    const result = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    result.message.slot = slot;
    result.message.parentBlockHash = parentHash;
    result.message.parentBlockRoot = parentRoot;
    result.message.blockHash = Buffer.alloc(32, value);
    result.message.value = value;
    result.signature = builderKey.sign(getExecutionPayloadBidSigningRoot(config, result.message)).toBytes();
    return result;
  }

  function signedAuth(valid = true): gloas.SignedBuilderRequestAuth {
    const message = {slot, data: authData};
    const domain = computeDomain(DOMAIN_BUILDER_REQUEST_AUTH, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signature = proposerKey.sign(computeSigningRoot(ssz.gloas.BuilderRequestAuth, message, domain)).toBytes();
    if (!valid) signature.fill(0);
    return {message, signature};
  }

  async function start(streamEnabled = true): Promise<void> {
    const api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({
        data: [{slot, validatorIndex: 7, pubkey: proposerPubkey}],
        meta: {executionOptimistic: false, dependentRoot: toHex(ZERO_HASH)},
      })
    );
    const clock = new ClockMock();
    clock.currentSlot = slot;
    bidStore = new BidStore();
    bidStore.add(bid(10));
    controller = new AbortController();
    const modules: BuilderApiModules = {
      api,
      clock,
      config,
      logger: testLogger(),
      bidStore,
      proposerDutiesTracker: new ProposerDutiesTracker(api, clock),
      builderIndex: 0,
      metrics: null,
      signal: controller.signal,
    };
    const builderApi = getBuilderApi(modules, {authData});
    const streamApi = getBuilderBidStreamApi(modules, {authData});
    httpBid = vi.fn(builderApi.getExecutionPayloadBid);
    streamOpen = vi.fn(streamApi.open);
    server = new InteropServer(
      {
        address: "127.0.0.1",
        port: 0,
        bidStream: streamEnabled,
        bidStreamAdaptiveTiming: streamEnabled && adaptiveTiming,
      },
      {
        config,
        logger: modules.logger,
        metrics: null,
        api: {...builderApi, getExecutionPayloadBid: httpBid},
        getBidStreamApi: () => ({open: streamOpen}),
      }
    );
    await server.listen();
    directory = await mkdtemp(join(tmpdir(), "lodestar-cb-interop-"));
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address();
    if (!address || typeof address === "string") throw Error("Expected TCP port");
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
    endpoint = `http://127.0.0.1:${port}`;
    const configuration = join(directory, "commit-boost.toml");
    await writeFile(
      configuration,
      `chain = "Hoodi"
[pbs]
port = ${port}
proposer_deadline_buffer_ms = 20
dial_unconfigured_builders = false
[[relays]]
id = "lodestar-local-fixture"
url = "http://${toHex(proposerPubkey)}@127.0.0.1:${server.port}"
get_header = "stream"
[metrics]
enabled = false
`
    );
    output = "";
    child = spawn(binary as string, ["pbs"], {
      cwd: directory,
      env: {
        PATH: "/usr/bin:/bin",
        CB_CONFIG: configuration,
        CB_PBS_ENDPOINT: `127.0.0.1:${port}`,
        CB_LOGS_DIR: directory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (data: Buffer): void => {
      output = (output + data.toString()).slice(-8000);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (error) => {
      output += error.message;
    });
    await vi.waitFor(
      async () => {
        expect(child?.exitCode, output).toBeNull();
        const response = await fetch(`${endpoint}/eth/v1/builder/status`, {signal: AbortSignal.timeout(500)});
        expect(response.status, output).toBe(200);
      },
      {timeout: 8000, interval: 50}
    );
  }

  function request(valid = true): Promise<Response> {
    return fetch(endpoint + requestPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Eth-Consensus-Version": "gloas",
        "Date-Milliseconds": String(Date.now()),
        "X-Timeout-Ms": "1500",
      },
      body: JSON.stringify(ssz.gloas.SignedBuilderRequestAuth.toJson(signedAuth(valid))),
      signal: AbortSignal.timeout(2500),
    });
  }

  it("returns the newer streamed bid, then an even newer bid on a second request", async () => {
    await start();
    for (const value of [20, 30]) {
      const started = performance.now();
      const calls = streamOpen.mock.calls.length;
      const pending = request();
      await vi.waitFor(() => expect(streamOpen).toHaveBeenCalledTimes(calls + 1));
      bidStore.add(bid(value));
      const response = await pending;
      expect(response.status, output).toBe(200);
      expect(performance.now() - started).toBeLessThan(1500);
      const body = (await response.json()) as {
        version: string;
        data: {message: {value: string; block_hash: string}; signature: string};
      };
      expect(body.version).toBe("gloas");
      expect(body.data.message.value).toBe(String(value));
      expect(body.data.message.block_hash).toBe(toHex(bid(value).message.blockHash));
      expect(body.data.signature).toBe(toHex(bid(value).signature));
      expect(bidStore.has(bid(10))).toBe(true);
    }
    expect(httpBid).not.toHaveBeenCalled();
  });

  it("falls back to ordinary HTTP when the stream is disabled", async () => {
    await start(false);
    const response = await request();
    expect(response.status, output).toBe(200);
    const body = (await response.json()) as {data: {message: {value: string}}};
    expect(body.data.message.value).toBe("10");
    expect(streamOpen).not.toHaveBeenCalled();
    expect(httpBid).toHaveBeenCalledOnce();
  });

  it("never serves a bid for an invalid proposer signature, including HTTP fallback", async () => {
    await start();
    const response = await request(false);
    expect(response.status, output).toBe(401);
    expect(streamOpen).toHaveBeenCalledOnce();
    expect(httpBid).toHaveBeenCalledOnce();
  });
});
