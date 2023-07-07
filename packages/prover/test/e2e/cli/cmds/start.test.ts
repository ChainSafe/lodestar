import childProcess from "node:child_process";
import {writeFile, mkdir} from "node:fs/promises";
import path from "node:path";
import {expect} from "chai";
import Web3 from "web3";
import {runCliCommand, spawnCliCommand, stopChildProcess} from "@lodestar/test-utils";
import {sleep} from "@lodestar/utils";
import {ChainConfig, chainConfigToJson} from "@lodestar/config";
import {getLodestarProverCli} from "../../../../src/cli/cli.js";
import {rpcUrl, beaconUrl, proxyPort, proxyUrl, chainId, waitForCapellaFork, config} from "../../../utils/e2e_env.js";

const cli = getLodestarProverCli();

describe("prover/start", () => {
  it("should show help", async () => {
    const output = await runCliCommand(cli, ["start", "--help"]);

    expect(output).contains("Show help");
  });

  it("should fail when --executionRpcUrl is missing", async () => {
    await expect(runCliCommand(cli, ["start", "--port", "8088"])).eventually.rejectedWith(
      "Missing required argument: executionRpcUrl"
    );
  });

  it("should fail when --beaconUrls and --beaconBootnodes are provided together", async () => {
    await expect(
      runCliCommand(cli, [
        "start",
        "--beaconUrls",
        "http://localhost:4000",
        "--beaconBootnodes",
        "http://localhost:0000",
      ])
    ).eventually.rejectedWith("Arguments beaconBootnodes and beaconUrls are mutually exclusive");
  });

  it("should fail when both of --beaconUrls and --beaconBootnodes are not provided", async () => {
    await expect(
      runCliCommand(cli, ["start", "--port", "8088", "--executionRpcUrl", "http://localhost:3000"])
    ).eventually.rejectedWith("Either --beaconUrls or --beaconBootnodes must be provided");
  });

  describe("when started", () => {
    let proc: childProcess.ChildProcess;
    const paramsFilePath = path.join("/tmp", "e2e-test-env", "params.json");
    const web3: Web3 = new Web3(proxyUrl);

    before(async function () {
      this.timeout(50000);
      await waitForCapellaFork();
      await mkdir(path.dirname(paramsFilePath), {recursive: true});
      await writeFile(paramsFilePath, JSON.stringify(chainConfigToJson(config as ChainConfig)));

      proc = await spawnCliCommand(
        "packages/prover/bin/lodestar-prover.js",
        [
          "start",
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
    });

    after(async () => {
      await stopChildProcess(proc);
    });

    it("should respond to verified calls", async () => {
      const accounts = await web3.eth.getAccounts();

      expect(accounts.length).to.be.gt(0);
      await expect(web3.eth.getBalance(accounts[0])).eventually.not.null;
    });

    it("should respond to unverified calls", async () => {
      await expect(web3.eth.getChainId()).eventually.eql(chainId);
    });
  });
});
