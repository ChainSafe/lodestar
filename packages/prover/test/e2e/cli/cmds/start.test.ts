import childProcess from "node:child_process";
import {writeFile, mkdir} from "node:fs/promises";
import path from "node:path";
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import {Web3} from "web3";
import {runCliCommand, spawnCliCommand, stopChildProcess} from "@lodestar/test-utils";
import {sleep} from "@lodestar/utils";
import {ChainConfig, chainConfigToJson} from "@lodestar/config";
import {getLodestarProverCli} from "../../../../src/cli/cli.js";
import {rpcUrl, beaconUrl, proxyPort, proxyUrl, chainId, waitForCapellaFork, config} from "../../../utils/e2e_env.js";

const cli = getLodestarProverCli();

describe("prover/proxy", () => {
  it("should show help", async () => {
    const output = await runCliCommand(cli, ["proxy", "--help"]);

    expect(output).toEqual(expect.stringContaining("Show help"));
  });

  it("should fail when --executionRpcUrl and --beaconUrls are missing", async () => {
    await expect(runCliCommand(cli, ["proxy", "--port", "8088"])).rejects.toThrow(
      "Missing required arguments: executionRpcUrl, beaconUrls"
    );
  });

  describe("when started", () => {
    let proc: childProcess.ChildProcess | null = null;
    const paramsFilePath = path.join("/tmp", "e2e-test-env", "params.json");
    const web3: Web3 = new Web3(proxyUrl);

    beforeAll(async () => {
      await waitForCapellaFork();
      await mkdir(path.dirname(paramsFilePath), {recursive: true});
      await writeFile(paramsFilePath, JSON.stringify(chainConfigToJson(config as ChainConfig)));

      proc = await spawnCliCommand(
        "packages/prover/bin/lodestar-prover.js",
        [
          "proxy",
          "--port",
          String(proxyPort as number),
          "--executionRpcUrl",
          rpcUrl,
          "--beaconUrls",
          beaconUrl,
          "--preset",
          "minimal",
          "--paramsFile",
          paramsFilePath,
        ],
        {runWith: "ts-node", pipeStdioToParent: true}
      );
      // Give sometime to the prover to start proxy server
      await sleep(3000);
    }, 50000);

    afterAll(async () => {
      if (proc) {
        await stopChildProcess(proc);
      }
    });

    it("should respond to verified calls", async () => {
      const accounts = await web3.eth.getAccounts();

      expect(accounts.length).toBeGreaterThan(0);
      await expect(web3.eth.getBalance(accounts[0])).resolves.not.toBeNull();
    });

    it("should respond to unverified calls", async () => {
      // Because web3 latest version return numbers as bigint by default
      await expect(web3.eth.getChainId()).resolves.toEqual(BigInt(chainId));
    });
  });
});
