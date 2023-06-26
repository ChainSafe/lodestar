import childProcess from "node:child_process";
import {expect} from "chai";
import Web3 from "web3";
import {runCliCommand, spawnCliCommand, stopChildProcess} from "@lodestar/test-util";
import {getLodestarProverCli} from "../../../../src/cli/cli.js";
import {rpcUrl, beaconUrl, proxyPort, proxyUrl, chainId, waitForCapellaFork} from "../../../utils/e2e_env.js";

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

  describe.skip("when started", () => {
    let proc: childProcess.ChildProcess;
    const web3: Web3 = new Web3(proxyUrl);

    before(async () => {
      await waitForCapellaFork();

      proc = await spawnCliCommand(
        "packages/prover/bin/lodestar-prover.js",
        ["--port", String(proxyPort as number), "--executionRpcUrl", rpcUrl, "--beaconUrls", beaconUrl],
        {runWith: "ts-node", pipeStdToParent: true}
      );
    });

    after(async () => {
      await stopChildProcess(proc);
    });

    it("should respond to verified calls", async () => {
      const accounts = await web3.eth.getAccounts();

      expect(accounts.length).to.be.gt(0);
      await expect(web3.eth.getBalance(accounts[0])).eventually.eql(chainId);
    });

    it("should respond to unverified calls", async () => {
      await expect(web3.eth.getChainId()).eventually.eql(chainId);
    });
  });
});
