import fs from "node:fs";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {getClient} from "@lodestar/api";
import {getClient as getSignerClient} from "@lodestar/api/signer";
import {config} from "@lodestar/config/default";
import {interopSecretKey} from "@lodestar/state-transition";
import {execCliCommand, spawnCliCommand, stopChildProcess} from "@lodestar/test-utils";
import {fetch, retry} from "@lodestar/utils";
import {Interchange} from "@lodestar/validator";
import {testFilesDir} from "../utils.js";

describe("signer cmd", () => {
  vi.setConfig({testTimeout: 120_000, hookTimeout: 60_000});

  const dataDir = path.join(testFilesDir, "signer-cmd");
  const signerDataDir = path.join(dataDir, "signer");
  // The dev command points its in-process validators at the default REST port
  const restPort = 9596;
  const signerPort = 39032;
  const metricsPort = 39033;
  const p2pPort = 39034;
  const beaconUrl = `http://127.0.0.1:${restPort}`;
  const signerUrl = `http://127.0.0.1:${signerPort}`;
  const signerIndexes = [6, 7];
  const signerPubkeys = signerIndexes.map((i) => interopSecretKey(i).toPublicKey().toHex());
  // Same params for every process so the validator client and the signer agree with the beacon node
  const params = ["--params.SLOT_DURATION_MS=2000", "--params.SHARD_COMMITTEE_PERIOD=0"];

  const procs: Awaited<ReturnType<typeof spawnCliCommand>>[] = [];
  const httpClientController = new AbortController();
  const client = getClient({baseUrl: beaconUrl, globalInit: {signal: httpClientController.signal}}, {config});
  const signerClient = getSignerClient({baseUrl: signerUrl, globalInit: {signal: httpClientController.signal}});

  beforeAll(async () => {
    fs.rmSync(dataDir, {recursive: true, force: true});

    procs.push(
      await spawnCliCommand(
        "packages/cli/bin/lodestar.js",
        [
          "dev",
          `--dataDir=${path.join(dataDir, "beacon")}`,
          "--genesisValidators=8",
          "--startValidators=0..5",
          "--rest",
          `--rest.port=${restPort}`,
          `--port=${p2pPort}`,
          ...params,
        ],
        {pipeStdioToParent: false, logPrefix: "dev"}
      )
    );

    procs.push(
      await spawnCliCommand(
        "packages/cli/bin/lodestar.js",
        [
          "signer",
          "--network=dev",
          `--dataDir=${signerDataDir}`,
          `--interopIndexes=${signerIndexes[0]}..${signerIndexes.at(-1)}`,
          `--port=${signerPort}`,
          "--metrics",
          `--metrics.port=${metricsPort}`,
          ...params,
        ],
        {pipeStdioToParent: false, logPrefix: "signer"}
      )
    );

    for (const proc of procs) {
      proc.on("exit", (code) => {
        if (code !== null && code > 0) {
          throw new Error(`process exited with code ${code}`);
        }
      });
    }

    await retry(async () => (await signerClient.upcheck()).assertOk(), {retryDelay: 1000, retries: 30});
  });

  afterAll(async () => {
    httpClientController.abort();
    for (const proc of procs.reverse()) {
      proc.removeAllListeners("exit");
      await stopChildProcess(proc, "SIGINT");
    }
  });

  it("serves the public keys of the loaded keystores", async () => {
    expect((await signerClient.listPublicKeys()).value()).toEqual(signerPubkeys);
  });

  it("signs attestations for a validator client", async () => {
    procs.push(
      await spawnCliCommand(
        "packages/cli/bin/lodestar.js",
        [
          "validator",
          "--network=dev",
          `--dataDir=${path.join(dataDir, "validator")}`,
          `--beaconNodes=${beaconUrl}`,
          `--externalSigner.url=${signerUrl}`,
          "--externalSigner.fetch",
          ...params,
        ],
        {pipeStdioToParent: false, logPrefix: "vc"}
      )
    );

    await retry(
      async () => {
        const signed = await getSignedCount("ATTESTATION");
        if (signed < 1) throw Error("No attestation signed yet");
      },
      {retryDelay: 2000, retries: 40}
    );

    // The validator client never saw the secret keys, the signer owns the slashing protection
    expect(await getSignedCount("ATTESTATION")).toBeGreaterThanOrEqual(1);
  });

  it("signs a voluntary exit", async () => {
    const [pubkeyToExit] = signerPubkeys;

    await execCliCommand(
      "packages/cli/bin/lodestar.js",
      [
        "validator",
        "voluntary-exit",
        "--network=dev",
        "--yes",
        `--externalSigner.url=${signerUrl}`,
        "--externalSigner.fetch=true",
        `--server=${beaconUrl}`,
        `--pubkeys=${pubkeyToExit}`,
        ...params,
      ],
      {pipeStdioToParent: false, logPrefix: "voluntary-exit"}
    );

    await retry(
      async () => {
        const validator = (await client.beacon.getStateValidator({stateId: "head", validatorId: pubkeyToExit})).value();
        if (validator.status !== "active_exiting") {
          throw Error(`Validator ${validator.status}`);
        }
      },
      {retryDelay: 1000, retries: 30}
    );
  });

  it("exports the slashing protection history after shutdown", async () => {
    // Stop the signer first, the export opens its database
    for (const proc of procs.splice(1).reverse()) {
      proc.removeAllListeners("exit");
      await stopChildProcess(proc, "SIGINT");
    }

    const file = path.join(dataDir, "interchange.json");
    await execCliCommand(
      "packages/cli/bin/lodestar.js",
      ["signer", "slashing-protection", "export", "--network=dev", `--dataDir=${signerDataDir}`, `--file=${file}`],
      {pipeStdioToParent: false, logPrefix: "export"}
    );

    // Only validators that got an attestation duty while the validator client was running are in the history
    const interchange = JSON.parse(fs.readFileSync(file, "utf8")) as Interchange;
    expect(interchange.data.length).toBeGreaterThanOrEqual(1);
    for (const validator of interchange.data) {
      expect(signerPubkeys).toContain(validator.pubkey);
      expect(validator.signed_attestations.length).toBeGreaterThanOrEqual(1);
    }
  });

  async function getSignedCount(type: string): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
    const metrics = await res.text();
    const line = metrics
      .split("\n")
      .find((line) => line.startsWith(`signer_sign_requests_total{type="${type}",result="signed"}`));
    return line ? Number(line.split(" ").at(-1)) : 0;
  }
});
