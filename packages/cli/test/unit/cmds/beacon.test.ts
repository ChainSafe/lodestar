import path from "node:path";
import fs from "node:fs";
import {describe, it, expect} from "vitest";
import {multiaddr} from "@multiformats/multiaddr";
import {ENR, SignableENR} from "@chainsafe/enr";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {chainConfig} from "@lodestar/config/default";
import {chainConfigToJson} from "@lodestar/config";
import {LogLevel} from "@lodestar/utils";
import {createFromJSON, exportToJSON} from "../../../src/config/peerId.js";
import {beaconHandlerInit} from "../../../src/cmds/beacon/handler.js";
import {initPrivateKeyAndEnr, isLocalMultiAddr} from "../../../src/cmds/beacon/initPeerIdAndEnr.js";
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
    expect(bootEnrs.includes(enr1)).toBe(true);
    expect(bootEnrs.includes(enr2)).toBe(true);
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

    expect(enr.ip).toBe(enrIp);
    expect(enr.tcp).toBe(enrTcp);
  });

  it("Create different PeerId every run", async () => {
    const {privateKey: pk1} = await runBeaconHandlerInit({});
    const {privateKey: pk2} = await runBeaconHandlerInit({});

    expect(pk1.equals(pk2)).toBe(false);
  });

  it("Re-use existing peer", async () => {
    const prevPk = await generateKeyPair("secp256k1");

    const peerIdFile = path.join(testFilesDir, "peer-id.json");
    fs.writeFileSync(peerIdFile, JSON.stringify(exportToJSON(prevPk)));
    const enr = SignableENR.createFromPrivateKey(prevPk);
    const enrFilePath = path.join(testFilesDir, "enr");
    fs.writeFileSync(enrFilePath, enr.encodeTxt());

    const {privateKey} = await runBeaconHandlerInit({
      persistNetworkIdentity: true,
    });

    expect(privateKey.equals(prevPk)).toBe(true);
  });

  it("Set known deposit contract", async () => {
    const {options} = await runBeaconHandlerInit({
      network: "mainnet",
    });

    // Okay to hardcode, since this value will never change
    expect(options.eth1.depositContractDeployBlock).toBe(11052984);
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
    expect(network).toBe(networkName);
  });
});

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).toBe(true);
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).toBe(false);
  });
});

describe("initPeerIdAndEnr", () => {
  it("should not reuse peer id, persistNetworkIdentity=false", async () => {
    const {privateKey: pk1} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: false} as BeaconArgs,
      testFilesDir,
      testLogger()
    );
    const {privateKey: pk2} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: false} as BeaconArgs,
      testFilesDir,
      testLogger()
    );

    expect(pk1.equals(pk2)).toBe(false);
  });

  it("should reuse peer id, persistNetworkIdentity=true", async () => {
    const {privateKey: pk1} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      testFilesDir,
      testLogger()
    );
    const {privateKey: pk2} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      testFilesDir,
      testLogger()
    );

    expect(pk1.equals(pk2)).toBe(true);
  });

  it("should overwrite invalid peer id", async () => {
    const peerIdFile = path.join(testFilesDir, "peer-id.json");
    const pk1Str = "wrong peer id file content";
    fs.writeFileSync(peerIdFile, pk1Str);
    const {privateKey: pk2} = await initPrivateKeyAndEnr(
      {persistNetworkIdentity: true} as BeaconArgs,
      testFilesDir,
      testLogger()
    );
    const filePk = createFromJSON(JSON.parse(fs.readFileSync(peerIdFile, "utf-8")));

    expect(pk1Str).not.toBe(peerIdFromPrivateKey(pk2).toString());
    expect(filePk.equals(pk2)).toBe(true);
  });

  it("should overwrite invalid enr", async () => {
    const enrFilePath = path.join(testFilesDir, "enr");
    const invalidEnr = "wrong enr file content";
    fs.writeFileSync(enrFilePath, invalidEnr);

    await initPrivateKeyAndEnr({persistNetworkIdentity: true} as BeaconArgs, testFilesDir, testLogger());

    const validEnr = fs.readFileSync(enrFilePath, "utf-8");

    expect(validEnr).not.toBe(invalidEnr);
  });

  it("should overwrite enr that doesn't match peer id", async () => {
    const otherPk = await generateKeyPair("secp256k1");
    const otherEnr = SignableENR.createFromPrivateKey(otherPk);
    const enrFilePath = path.join(testFilesDir, "enr");
    const otherEnrStr = otherEnr.encodeTxt();
    fs.writeFileSync(enrFilePath, otherEnrStr);

    const {enr} = await initPrivateKeyAndEnr({persistNetworkIdentity: true} as BeaconArgs, testFilesDir, testLogger());

    expect(enr.nodeId).not.toBe(otherEnr);
  });
});

async function runBeaconHandlerInit(args: Partial<BeaconArgs & GlobalArgs>) {
  return beaconHandlerInit({
    logLevel: LogLevel.info,
    logFileLevel: LogLevel.debug,
    dataDir: testFilesDir,
    ...args,
  } as BeaconArgs & GlobalArgs);
}
