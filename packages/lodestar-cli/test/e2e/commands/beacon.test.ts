import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import rimraf from "rimraf";
import fs from "fs";
import {assert} from "chai";
import {BeaconNodeCommand, DepositCommand, IBeaconCommandOptions} from "../../../src/commands";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {PrivateEth1Network} from "@chainsafe/lodestar/lib/eth1/dev";
import {JsonRpcProvider} from "ethers/providers";
import {createPeerId} from "@chainsafe/lodestar/lib/network";
import {savePeerId} from "@chainsafe/lodestar/lib/network/nodejs";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {dump} from "js-yaml";

describe("beacon cli", function() {
  this.timeout(0);

  const logger: ILogger = new WinstonLogger();
  logger.silent = true;
  //same folder of default db
  const tmpDir = ".tmp";
  const peerIdPath = `${tmpDir}/peer-id.json`;
  const forkFile = `${tmpDir}/forks.yml`;

  before(async () => {
    if (fs.existsSync(tmpDir)) {
      rimraf.sync(tmpDir);
    }
    fs.mkdirSync(`${tmpDir}/lodestar-db`, {recursive: true});
    const peerId = await createPeerId();
    await savePeerId(peerIdPath, peerId);
    const ALL_FORKS = [
      {
        currentVersion: 2,
        epoch: 100,
        // GENESIS_FORK_VERSION is <Buffer 00 00 00 01> but previousVersion = 16777216 not 1 due to bytesToInt
        previousVersion: bytesToInt(config.params.GENESIS_FORK_VERSION)
      },
    ];
    const yml = dump(ALL_FORKS);
    fs.writeFileSync(forkFile, yml);
  });

  after(() => {
    rimraf.sync(tmpDir);
  });

  it("standalone - should start/stop beacon node from eth1", async function() {
    // start eth1 and deploy contract
    const eth1Network = new PrivateEth1Network(
      {host: "127.0.0.1", port: 32567, "total_accounts": 64},
      {logger,}
    );
    await eth1Network.start();
    const contractAddress = await eth1Network.deployDepositContract();
    // deposit eth1
    const depCmd = new DepositCommand();
    await depCmd.action(
      {
        preset: "minimal",
        privateKey:null,
        logLevel:null,
        mnemonic:eth1Network.mnemonic(),
        unencryptedKeys: null,
        unencryptedBlsKeys: null,
        abi: null,
        node:eth1Network.rpcUrl(),
        value:"32",
        contract:contractAddress,
        accounts: 64
      }, logger
    );
    // Start node with specified state
    const provider = new JsonRpcProvider(eth1Network.rpcUrl());
    const block = await provider.getBlock("latest");
    const cmdOptions = {
      preset: "minimal",
      eth1: "ganache",
      peerId: peerIdPath,
      eth1BlockNum: block.number.toString(),
      eth1RpcUrl: eth1Network.rpcUrl(),
      networkId: "999",
      depositContractBlockNum: "0", // not really but it's ok
      depositContract: contractAddress,
      forkFile: forkFile,
      config: config,
    } as unknown as IBeaconCommandOptions;
    cmdOptions.config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT = 48;
    const cmd = new BeaconNodeCommand();
    const node = await cmd.action(cmdOptions, logger);
    logger.verbose("cmd.action started node successfully");
    const enrForkID = await node.chain.getENRForkID();
    assert(config.types.Version.equals(enrForkID.nextForkVersion, intToBytes(2, 4)));
    assert(enrForkID.nextForkEpoch === 100);
    await new Promise((resolve) => setTimeout(resolve, 10 * config.params.SECONDS_PER_SLOT * 1000));
    await cmd.node.stop();
    logger.verbose("cmd.stop stopped node successfully");
    await eth1Network.stop();
  });


});
