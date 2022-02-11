import {createIBeaconConfig, IBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {LogLevel, testLogger, TestLoggerOpts} from "../../utils/logger";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {getAndInitValidatorsWithKeystoreOne, getAndInitValidatorsWithKeystoreTwo} from "../../utils/node/validator";
import {KeymanagerApi, KeymanagerServer, SecretKeyInfo} from "@chainsafe/lodestar-keymanager-server";
import {chainConfig as chainConfigDef} from "@chainsafe/lodestar-config/default";
import {getKeymanagerClient, HttpClient} from "@chainsafe/lodestar-api/src";
import {ISlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import fs from "node:fs";

describe("keymanager delete and import test", async function () {
  const validatorCount = 1;
  const SECONDS_PER_SLOT = 2;
  const ALTAIR_FORK_EPOCH = 0;
  const key1 = "0x97b1b00d3c1888b5715c2c88bf1df7b0ad715388079de211bdc153697b69b868c671af3b2d86c5cdfbade48d03888ab4";
  const key2 = "0xa74e11fd129b9bafc2d6afad4944cd289c238139130a7abafe7b28dde1923a0e4833ad776f9e0d7aaaecd9f0acbfedd3";
  const beaconParams: Partial<IChainConfig> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: SECONDS_PER_SLOT,
  };

  it("should migrate validator from one VC to another", async function () {
    this.timeout("10 min");

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
    });

    const vc1Info = await getAndInitValidatorsWithKeystoreOne({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      useRestApi: false,
      testLoggerOpts,
    });

    const vc2Info = await getAndInitValidatorsWithKeystoreTwo({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      useRestApi: false,
      testLoggerOpts,
    });

    const portKM1 = 10000;
    const portKM2 = 10001;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const keymanagerServerForVC1 = createKeymanager(
      vc1Info.validator,
      vc1Info.slashingProtection,
      [vc1Info.tempDirs.keystoreDir.name],
      vc1Info.secretKeysInfo,
      portKM1,
      config,
      loggerNodeA
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const keymanagerServerForVC2 = createKeymanager(
      vc2Info.validator,
      vc2Info.slashingProtection,
      [vc2Info.tempDirs.keystoreDir.name],
      vc2Info.secretKeysInfo,
      portKM2,
      config,
      loggerNodeA
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    await keymanagerServerForVC1.listen();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    await keymanagerServerForVC2.listen();

    // 1. CONFIRM KEYS BEFORE DELETION AND IMPORT
    const clientKM1 = getKeymanagerClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${portKM1}`}));
    const clientKM2 = getKeymanagerClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${portKM2}`}));

    // 1.a. CONFIRM PRESENCE KEYS VIA API

    // confirm pubkey key1 in first validator client
    let km1ListKeyResult = await clientKM1.listKeys();
    expect(km1ListKeyResult.data.length).to.equal(1);
    expect(km1ListKeyResult.data[0].validatingPubkey).to.equal(key1);
    expect(km1ListKeyResult.data[0].validatingPubkey).to.not.equal(key2);

    // confirm pubkey key2 in second validator client
    let km2ListKeyResult = await clientKM2.listKeys();
    expect(km2ListKeyResult.data.length).to.equal(1);
    expect(km2ListKeyResult.data[0].validatingPubkey).to.equal(key2);
    expect(km2ListKeyResult.data[0].validatingPubkey).to.not.equal(key1);

    // 1.b. CONFIRM PRESENCE OF KEYS VIA FILE SYSTEM

    // confirm keystore for k1 exist on file
    const keystoreFile1 = vc1Info.secretKeysInfo[0].keystorePath;
    expect(fs.existsSync(keystoreFile1 as string)).to.be.true;
    expect(dirContainFileWithContent(vc1Info.tempDirs.keystoreDir.name, key1)).to.be.true;
    expect(dirContainFileWithContent(vc1Info.tempDirs.keystoreDir.name, key2)).to.be.false;
    // confirm keystore for k2 exist on file
    const keystoreFile2 = vc1Info.secretKeysInfo[0].keystorePath;
    expect(fs.existsSync(keystoreFile2 as string)).to.be.true;
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, key2)).to.be.true;
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, key1)).to.be.false;

    // 2. DELETE PUBKEY K1 from first validator client
    // delete pubkey key1 in vc1Info
    const km1DeleteKeyResult = await clientKM1.deleteKeystores([key1]);

    // 2.a CONFIRM DELETION OF K1 from first validator client USING API AND FILESYSTEM
    // confirm pubkey key1 is no longer in vc1Info
    km1ListKeyResult = await clientKM1.listKeys();
    expect(km1ListKeyResult.data.length).to.equal(0);
    // confirm keystore for k1 no longer exist on file
    expect(fs.existsSync(keystoreFile1 as string)).to.be.false;

    // 3. IMPORT PUBKEY K1 to SECOND VALIDATOR CLIENT

    const importResult = await clientKM2.importKeystores(
      [vc1Info.keystoreContent],
      ["test123!"],
      JSON.parse(km1DeleteKeyResult.slashingProtection)
    );

    // 3.a. COMFIRM IMPORT RESPONSE
    expect(importResult.data[0].status).to.be.equal("imported");

    // 4 CONFIRM PRESENCE OF IMPORTED KEY IN SECOND VALIDATOR CLIENT.
    // 4.a Confirm via api
    km2ListKeyResult = await clientKM2.listKeys();
    expect(km2ListKeyResult.data.length).to.equal(2);
    expect(km2ListKeyResult.data.some((key) => key.validatingPubkey === key1)).to.true;
    expect(km2ListKeyResult.data.some((key) => key.validatingPubkey === key2)).to.true;

    // 4.b Confirm via file system
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, key1)).to.be.true;
    // previous key also still exist on file system
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, key2)).to.be.true;

    // 5. CLEAN UP
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    await Promise.all([vc1Info.validator.stop(), vc2Info.validator.stop()]);
    await bn.close();
    await keymanagerServerForVC1.close();
    await keymanagerServerForVC2.close();
    vc1Info.tempDirs.keystoreDir.removeCallback();
    vc1Info.tempDirs.passwordFile.removeCallback();
    vc2Info.tempDirs.keystoreDir.removeCallback();
    vc2Info.tempDirs.passwordFile.removeCallback();
  });
});

function dirContainFileWithContent(dir: string, content: string): boolean {
  return fs.readdirSync(dir).some((name) => {
    const fileContent = fs.readFileSync(`${dir}/${name}`, {encoding: "utf8"});
    return fileContent !== "" && fileContent.indexOf(content.substring(2)) !== -1;
  });
}

function createKeymanager(
  vc: Validator,
  slashingProtection: ISlashingProtection,
  importKeystoresPath: string[],
  secretKeysInfo: SecretKeyInfo[],
  port: number,
  config: IBeaconConfig,
  logger: WinstonLogger
): KeymanagerServer {
  const keymanagerApi = new KeymanagerApi(
    vc,
    slashingProtection,
    vc.genesis.genesisValidatorsRoot,
    importKeystoresPath,
    secretKeysInfo
  );

  return new KeymanagerServer(
    {host: "127.0.0.1", port, cors: "*", auth: false, tokenDir: "."},
    {config, logger: logger, api: keymanagerApi}
  );
}
