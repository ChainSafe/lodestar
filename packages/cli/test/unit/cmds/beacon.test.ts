import path from "node:path";
import fs from "node:fs";
import {expect} from "chai";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {chainConfig} from "@lodestar/config/default";
import {chainConfigToJson} from "@lodestar/config";
import {createKeypairFromPeerId, ENR, SignableENR} from "@chainsafe/discv5";
import {exportToJSON} from "../../../src/config/peerId.js";
import {beaconHandlerInit, initLogger, initPeerIdAndEnr} from "../../../src/cmds/beacon/handler.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {GlobalArgs} from "../../../src/options/globalOptions.js";
import {testFilesDir} from "../../utils.js";
import {getBeaconConfigFromArgs} from "../../../src/config/beaconParams.js";

describe("cmds / beacon / args handler", () => {
  // Make tests faster skipping a network call
  process.env.SKIP_FETCH_NETWORK_BOOTNODES = "true";

  it("Merge bootnodes from file and CLI arg", async () => {
    const enr1 = "enr:-AAKG4QOWkRj";
    const enr2 = "enr:-BBBBBBW4gMj";

    const bootnodesFile = path.join(testFilesDir, "bootnodesFile.txt");
    fs.writeFileSync(bootnodesFile, enr1);

    const {options} = await runBeaconHandlerInit({
      bootnodes: [enr2],
      bootnodesFile,
    });

    expect(options.network.discv5?.bootEnrs?.sort().slice(0, 2)).to.deep.equal([enr1, enr2]);
  });

  it("Over-write ENR fields", async () => {
    const enrIp = "10.20.30.40";
    const enrTcp = 4000;

    const {beaconPaths} = await runBeaconHandlerInit({
      listenAddress: "0.0.0.0",
      "enr.ip": enrIp,
      "enr.tcp": enrTcp,
    });

    const enrTxt = fs.readFileSync(path.join(beaconPaths.beaconDir, "enr"), "utf8");
    const enr = ENR.decodeTxt(enrTxt);

    expect(enr.ip).to.equal(enrIp, "wrong enr.ip");
    expect(enr.tcp).to.equal(enrTcp, "wrong enr.tcp");
  });

  it("Create different PeerId every run", async () => {
    const {peerId: peerId1} = await runBeaconHandlerInit({});
    const {peerId: peerId2} = await runBeaconHandlerInit({});

    expect(peerId1.toString()).not.equal(peerId2.toString(), "peer ids must be different");
  });

  it("Re-use existing peer", async () => {
    const prevPeerId = await createSecp256k1PeerId();

    const peerIdFile = path.join(testFilesDir, "prev_peerid.json");
    fs.writeFileSync(peerIdFile, JSON.stringify(exportToJSON(prevPeerId)));
    const enr = SignableENR.createV4(createKeypairFromPeerId(prevPeerId));
    const enrFilePath = path.join(testFilesDir, "enr");
    fs.writeFileSync(enrFilePath, enr.encodeTxt());

    const {peerId} = await runBeaconHandlerInit({
      peerIdFile,
    });

    expect(peerId.toString()).equal(prevPeerId.toString(), "peer must be equal to persisted");
  });

  it("Set known deposit contract", async () => {
    const {options} = await runBeaconHandlerInit({
      network: "mainnet",
    });

    // Okay to hardcode, since this value will never change
    expect(options.eth1.depositContractDeployBlock).equal(11052984, "Wrong mainnet eth1.depositContractDeployBlock");
  });

  it("Apply custom network name from config file", async () => {
    const networkName = "test-network";
    const config = {...chainConfig};
    config.CONFIG_NAME = networkName;

    const paramsFile = path.join(testFilesDir, "custom_config.yaml");
    fs.writeFileSync(paramsFile, JSON.stringify(chainConfigToJson(config)));

    const {network} = await runBeaconHandlerInit({
      paramsFile,
    });

    // Okay to hardcode, since this value will never change
    expect(network).equal(networkName, "Wrong network name");
  });
});

describe("initPeerIdAndEnr", () => {
  it("should not reuse peer id, no peerIdFile", async () => {
    const {peerId: peerId1} = await runBeaconHandlerInit({});
    const {peerId: peerId2} = await runBeaconHandlerInit({});

    expect(peerId1.toString()).not.equal(peerId2.toString(), "peer ids must be different");
  });

  it("should not reuse peer id, not existed peerIdFile", async () => {
    const notExistPeerIdFile = path.join(testFilesDir, "peer_id_not_exist.json");
    const {peerId: peerId1} = await runBeaconHandlerInit({peerIdFile: notExistPeerIdFile});
    const {peerId: peerId2} = await runBeaconHandlerInit({peerIdFile: notExistPeerIdFile});

    expect(peerId1.toString()).not.equal(peerId2.toString(), "peer ids must be different");
  });

  it("should not reuse peer id, not able to load peerIdFile", async () => {
    const peerIdFile = path.join(testFilesDir, "prev_peerid.json");
    fs.writeFileSync(peerIdFile, "wrong peer id file content");
    const {peerId: peerId1} = await runBeaconHandlerInit({peerIdFile});
    const {peerId: peerId2} = await runBeaconHandlerInit({peerIdFile});

    expect(peerId1.toString()).not.equal(peerId2.toString(), "peer ids must be different");
  });

  it("should not reuse peer id, not able to load enr file", async () => {
    const prevPeerId = await createSecp256k1PeerId();
    const peerIdFile = path.join(testFilesDir, "prev_peerid.json");
    fs.writeFileSync(peerIdFile, JSON.stringify(exportToJSON(prevPeerId)));

    const enrFilePath = path.join(testFilesDir, "enr");
    fs.writeFileSync(enrFilePath, "wrong enr file content");

    const {peerId: peerId1} = await runBeaconHandlerInit({peerIdFile});
    const {peerId: peerId2} = await runBeaconHandlerInit({peerIdFile});

    expect(peerId1.toString()).not.equal(peerId2.toString(), "peer ids must be different");
  });

  it("should not reuse peer id, enr peer id is not the same to peer id file", async () => {
    const prevPeerId = await createSecp256k1PeerId();
    const peerIdFile = path.join(testFilesDir, "prev_peerid.json");
    fs.writeFileSync(peerIdFile, JSON.stringify(exportToJSON(prevPeerId)));

    const enrPeerId = await createSecp256k1PeerId();
    const enr = SignableENR.createV4(createKeypairFromPeerId(enrPeerId));
    const enrFilePath = path.join(testFilesDir, "enr");
    fs.writeFileSync(enrFilePath, enr.encodeTxt());

    const {peerId} = await runInitPeerIdAndEnr({peerIdFile});
    expect(peerId.toString()).not.equal(prevPeerId.toString(), "peer ids must be different");
    expect(peerId.toString()).not.equal(enrPeerId.toString(), "peer ids must be different");
  });

  it("should reuse peer id and enr", async () => {
    const prevPeerId = await createSecp256k1PeerId();

    const peerIdFile = path.join(testFilesDir, "prev_peerid.json");
    fs.writeFileSync(peerIdFile, JSON.stringify(exportToJSON(prevPeerId)));
    const enr = SignableENR.createV4(createKeypairFromPeerId(prevPeerId));
    const enrFilePath = path.join(testFilesDir, "enr");
    fs.writeFileSync(enrFilePath, enr.encodeTxt());
    // try 2 times
    for (let i = 0; i < 2; i++) {
      const {peerId} = await runInitPeerIdAndEnr({peerIdFile});
      expect(peerId.toString()).equal(prevPeerId.toString(), "peer must be equal to persisted");
    }
  });
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function runBeaconHandlerInit(args: Partial<BeaconArgs & GlobalArgs>) {
  return beaconHandlerInit({
    dataDir: testFilesDir,
    ...args,
  } as BeaconArgs & GlobalArgs);
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function runInitPeerIdAndEnr(args: Partial<BeaconArgs & GlobalArgs>) {
  const args2 = {...args, dataDir: testFilesDir} as BeaconArgs & GlobalArgs;
  const {config} = getBeaconConfigFromArgs(args2);
  const logger = initLogger(args2, testFilesDir, config);
  return initPeerIdAndEnr(args2, testFilesDir, logger);
}
