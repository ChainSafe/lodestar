import path from "node:path";
import fs from "node:fs";
import {expect} from "chai";
import {createFromJSON, createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {multiaddr} from "@multiformats/multiaddr";
import {createKeypairFromPeerId, ENR, SignableENR} from "@chainsafe/discv5";
import {chainConfig} from "@lodestar/config/default";
import {chainConfigToJson} from "@lodestar/config";
import {LogLevel} from "@lodestar/utils";
import {exportToJSON} from "../../../src/config/peerId.js";
import {beaconHandlerInit} from "../../../src/cmds/beacon/handler.js";
import {initPeerIdAndEnr, isLocalMultiAddr} from "../../../src/cmds/beacon/initPeerIdAndEnr.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {GlobalArgs} from "../../../src/options/globalOptions.js";
import {testFilesDir, testLogger} from "../../utils.js";

describe("cmds / beacon / args handler", () => {
  // Make tests faster skipping a network call
  process.env.SKIP_FETCH_NETWORK_BOOTNODES = "true";

  it("Merge bootnodes from file and CLI arg", async () => {
    const enr1 =
      "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA";
    const enr2 =
      "enr:-KG4QDyytgmE4f7AnvW-ZaUOIi9i79qX4JwjRAiXBZCU65wOfBu-3Nb5I7b_Rmg3KCOcZM_C3y5pg7EBU5XGrcLTduQEhGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQ2_DUbiXNlY3AyNTZrMaEDKnz_-ps3UUOfHWVYaskI5kWYO_vtYMGYCQRAR3gHDouDdGNwgiMog3VkcIIjKA";

    const bootnodesFile = path.join(testFilesDir, "bootnodesFile.txt");
    fs.writeFileSync(bootnodesFile, enr1);

    const {options} = await runBeaconHandlerInit({
      bootnodes: [enr2],
      bootnodesFile,
    });

    const bootEnrs = options.network.discv5?.bootEnrs ?? [];
    expect(bootEnrs.includes(enr1)).to.be.true;
    expect(bootEnrs.includes(enr2)).to.be.true;
  });

  it("Over-write ENR fields", async () => {
    const enrIp = "10.20.30.40";
    const enrTcp = 4000;

    const {options} = await runBeaconHandlerInit({
      listenAddress: "0.0.0.0",
      "enr.ip": enrIp,
      "enr.tcp": enrTcp,
      nat: true,
    });

    const enr = ENR.decodeTxt(options.network.discv5?.enr as string);

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

    const peerIdFile = path.join(testFilesDir, "peer-id.json");
    fs.writeFileSync(peerIdFile, JSON.stringify(exportToJSON(prevPeerId)));
    const enr = SignableENR.createV4(createKeypairFromPeerId(prevPeerId));
    const enrFilePath = path.join(testFilesDir, "enr");
    fs.writeFileSync(enrFilePath, enr.encodeTxt());

    const {peerId} = await runBeaconHandlerInit({
      persistNetworkIdentity: true,
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

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.equal(true);
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.equal(false);
  });
});

describe("initPeerIdAndEnr", () => {
  it("should not reuse peer id, persistNetworkIdentity=false", async () => {
    const {peerId: peerId1} = await initPeerIdAndEnr(
      {persistNetworkIdentity: false} as BeaconArgs,
      testFilesDir,
      testLogger()
    );
    const {peerId: peerId2} = await initPeerIdAndEnr(
      {persistNetworkIdentity: false} as BeaconArgs,
      testFilesDir,
      testLogger()
    );

    expect(peerId1.toString()).not.equal(peerId2.toString(), "peer ids must be different");
  });

  it("should reuse peer id, persistNetworkIdentity=true", async () => {
    const {peerId: peerId1} = await initPeerIdAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      testFilesDir,
      testLogger()
    );
    const {peerId: peerId2} = await initPeerIdAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      testFilesDir,
      testLogger()
    );

    expect(peerId1.toString()).to.equal(peerId2.toString(), "peer ids must be equal");
  });

  it("should overwrite invalid peer id", async () => {
    const peerIdFile = path.join(testFilesDir, "peer-id.json");
    const peerId1Str = "wrong peer id file content";
    fs.writeFileSync(peerIdFile, peerId1Str);
    const {peerId: peerId2} = await initPeerIdAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      testFilesDir,
      testLogger()
    );
    const filePeerId = await createFromJSON(JSON.parse(fs.readFileSync(peerIdFile, "utf-8")));

    expect(peerId1Str).not.equal(peerId2.toString(), "peer ids must be different");
    expect(filePeerId.toString()).to.equal(peerId2.toString(), "peer ids must be equal");
  });

  it("should overwrite invalid enr", async () => {
    const enrFilePath = path.join(testFilesDir, "enr");
    const invalidEnr = "wrong enr file content";
    fs.writeFileSync(enrFilePath, invalidEnr);

    await initPeerIdAndEnr({persistNetworkIdentity: true} as BeaconArgs, testFilesDir, testLogger());

    const validEnr = fs.readFileSync(enrFilePath, "utf-8");

    expect(validEnr).not.equal(invalidEnr, "enrs must be different");
  });

  it("should overwrite enr that doesn't match peer id", async () => {
    const otherPeerId = await createSecp256k1PeerId();
    const otherEnr = SignableENR.createFromPeerId(otherPeerId);
    const enrFilePath = path.join(testFilesDir, "enr");
    const otherEnrStr = otherEnr.encodeTxt();
    fs.writeFileSync(enrFilePath, otherEnrStr);

    const {enr} = await initPeerIdAndEnr({persistNetworkIdentity: true} as BeaconArgs, testFilesDir, testLogger());

    expect(enr.nodeId).not.equal(otherEnr, "enrs must be different");
  });
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function runBeaconHandlerInit(args: Partial<BeaconArgs & GlobalArgs>) {
  return beaconHandlerInit({
    logLevel: LogLevel.info,
    logFileLevel: LogLevel.debug,
    dataDir: testFilesDir,
    ...args,
  } as BeaconArgs & GlobalArgs);
}
