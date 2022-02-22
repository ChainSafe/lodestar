import {createIBeaconConfig, IBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {LogLevel, testLogger, TestLoggerOpts} from "../../utils/logger";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {ssz} from "@chainsafe/lodestar-types";
import {getAndInitDevValidators, getAndInitValidatorsWithKeystoreOne} from "../../utils/node/validator";
import {KeymanagerApi, KeymanagerServer} from "@chainsafe/lodestar-keymanager-server";
import {chainConfig as chainConfigDef} from "@chainsafe/lodestar-config/default";
import {getKeymanagerClient, HttpClient} from "@chainsafe/lodestar-api/src";
import {ISlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import fs from "node:fs";
import {ByteVector, fromHexString} from "@chainsafe/ssz";
import {join} from "node:path";
import {getKeystoreForPubKey1, getKeystoreForPubKey2} from "../../utils/node/keymanager";

/* eslint-disable @typescript-eslint/naming-convention */
describe("keymanager delete and import test", async function () {
  const validatorCount = 1;
  const SECONDS_PER_SLOT = 2;
  const ALTAIR_FORK_EPOCH = 0;
  const key1 = "0x97b1b00d3c1888b5715c2c88bf1df7b0ad715388079de211bdc153697b69b868c671af3b2d86c5cdfbade48d03888ab4";
  const key2 = "0xa74e11fd129b9bafc2d6afad4944cd289c238139130a7abafe7b28dde1923a0e4833ad776f9e0d7aaaecd9f0acbfedd3";
  const beaconParams: Partial<IChainConfig> = {
    SECONDS_PER_SLOT: SECONDS_PER_SLOT,
  };

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("should migrate validator from one VC to another", async function () {
    this.timeout("10 min");

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
      keystorePubKey: key1,
      keystoreContent: getKeystoreForPubKey1(),
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      useRestApi: false,
      testLoggerOpts,
    });

    const vc2Info = await getAndInitValidatorsWithKeystoreOne({
      node: bn,
      keystorePubKey: key2,
      keystoreContent: getKeystoreForPubKey2(),
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      useRestApi: false,
      testLoggerOpts,
    });

    const portKM1 = 10000;
    const portKM2 = 10001;

    const keymanagerServerForVC1 = createKeymanager(
      vc1Info.validator,
      vc1Info.slashingProtection,
      vc1Info.tempDirs.keystoreDir.name,
      portKM1,
      config,
      loggerNodeA
    );

    const keymanagerServerForVC2 = createKeymanager(
      vc2Info.validator,
      vc2Info.slashingProtection,
      vc2Info.tempDirs.keystoreDir.name,
      portKM2,
      config,
      loggerNodeA
    );

    // Register clean up
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    afterEachCallbacks.push(async () => {
      await Promise.all([vc1Info.validator.stop(), vc2Info.validator.stop()]);
      await bn.close();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      await keymanagerServerForVC1.close();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      await keymanagerServerForVC2.close();
      vc1Info.tempDirs.keystoreDir.removeCallback();
      vc1Info.tempDirs.passwordFile.removeCallback();
      vc2Info.tempDirs.keystoreDir.removeCallback();
      vc2Info.tempDirs.passwordFile.removeCallback();
    });

    await keymanagerServerForVC1.listen();
    await keymanagerServerForVC2.listen();

    // 1. CONFIRM KEYS BEFORE DELETION AND IMPORT
    const clientKM1 = getKeymanagerClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${portKM1}`}));
    const clientKM2 = getKeymanagerClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${portKM2}`}));

    // 1.a. CONFIRM PRESENCE KEYS VIA API

    // confirm pubkey key1 in first validator client
    let km1ListKeyResult = await clientKM1.listKeys();
    expect(km1ListKeyResult.data.map((d) => d.validatingPubkey)).to.deep.equal(
      [key1],
      "confirm pubkey key1 in first validator client"
    );

    // confirm pubkey key2 in second validator client
    let km2ListKeyResult = await clientKM2.listKeys();
    expect(km2ListKeyResult.data.map((d) => d.validatingPubkey)).to.deep.equal(
      [key2],
      "confirm pubkey key2 in second validator client"
    );

    // 1.b. CONFIRM PRESENCE OF KEYS VIA FILE SYSTEM

    // confirm keystore for k1 exist on file
    expect(dirContainFileWithContent(vc1Info.tempDirs.keystoreDir.name, [key1])).to.be.true;
    expect(dirContainFileWithContent(vc1Info.tempDirs.keystoreDir.name, [key2])).to.be.false;
    // confirm keystore for k2 exist on file
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, [key2])).to.be.true;
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, [key1])).to.be.false;

    // 2. DELETE PUBKEY K1 from first validator client
    // delete pubkey key1 in vc1Info
    const km1DeleteKeyResult = await clientKM1.deleteKeystores([key1]);

    // 2.a CONFIRM DELETION OF K1 from first validator client USING API AND FILESYSTEM
    // confirm pubkey key1 is no longer in vc1Info
    km1ListKeyResult = await clientKM1.listKeys();
    expect(km1ListKeyResult.data.length).to.equal(0);
    // confirm keystore for k1 no longer exist on file
    expect(dirContainFileWithContent(vc1Info.tempDirs.keystoreDir.name, [key1])).to.be.false;

    // 3. IMPORT PUBKEY K1 to SECOND VALIDATOR CLIENT

    // 3.a Confirmation before import, that signing with k1 on vc2 throws
    expect(async () => {
      await vc2Info.validator.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(key1), 0, 0, 1),
        ssz.phase0.AttestationData.defaultValue(),
        1
      );
    }).to.throw;

    // Import k1 to vc2
    const importResult = await clientKM2.importKeystores(
      [vc1Info.keystoreContent],
      ["test123!"],
      JSON.parse(km1DeleteKeyResult.slashingProtection)
    );

    // 3.b. COMFIRM IMPORT RESPONSE
    expect(importResult.data[0].status).to.be.equal("imported");

    // 4 CONFIRM PRESENCE OF IMPORTED KEY IN SECOND VALIDATOR CLIENT.
    // 4.a Confirm via api
    km2ListKeyResult = await clientKM2.listKeys();
    expect(km2ListKeyResult.data.map((d) => d.validatingPubkey)).to.deep.equal(
      [key2, key1],
      "confirm imported keys in vc 2"
    );

    // 4.b Confirm imported and previous key still exist via file system
    expect(dirContainFileWithContent(vc2Info.tempDirs.keystoreDir.name, [key1, key2])).to.be.true;

    // 4.c Confirm vc1 cannot sign with k1
    expect(async () => {
      await vc1Info.validator.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(key1), 0, 0, 1),
        ssz.phase0.AttestationData.defaultValue(),
        1
      );
    }).to.throw;

    // 4.d Confirm vc2 can now sign with k1
    expect(async () => {
      await vc2Info.validator.validatorStore.signAttestation(
        createAttesterDuty(fromHexString(key1), 0, 0, 1),
        ssz.phase0.AttestationData.defaultValue(),
        1
      );
    }).to.not.throw;
  });

  it("should deny request if authentication is on and no bearer token is provided", async function () {
    this.timeout("10 min");

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

    const {validators, secretKeys: _secretKeys, keymanagerOps} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });

    if (keymanagerOps) {
      const keymanagerApi = new KeymanagerApi(
        loggerNodeA,
        validators[0],
        keymanagerOps[0],
        validators[0].genesis.genesisValidatorsRoot,
        "/test/path"
      );

      const kmPort = 10003;

      // by default auth is on
      const keymanagerServer = new KeymanagerServer(
        {host: "127.0.0.1", port: kmPort, cors: "*", tokenDir: "."},
        {config, logger: loggerNodeA, api: keymanagerApi}
      );

      // clean up
      afterEachCallbacks.push(async () => {
        await Promise.all(validators.map((v) => v.stop()));
        await keymanagerServer.close();
        await bn.close();
      });

      await keymanagerServer.listen();

      const client = getKeymanagerClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${kmPort}`}));

      // Listing keys is denied
      try {
        await client.listKeys();
      } catch (e) {
        // prettier-ignore
        expect((e as Error).message).to.equal("Unauthorized: {\"error\":\"missing authorization header\"}");
      }

      // Deleting keys is denied
      try {
        await client.deleteKeystores([key1]);
      } catch (e) {
        // prettier-ignore
        expect((e as Error).message).to.equal("Unauthorized: {\"error\":\"missing authorization header\"}");
      }

      // importing keys is denied
      try {
        await client.importKeystores(["some keystore string"], ["some password"], "some slashing protecting)");
      } catch (e) {
        // prettier-ignore
        expect((e as Error).message).to.equal("Unauthorized: {\"error\":\"missing authorization header\"}");
      }
    }
  });

  it("should not delete external signers", async function () {
    this.timeout("10 min");

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

    const externalSignerPort = 38000;
    const externalSignerUrl = `http://localhost:${externalSignerPort}`;

    const {validators, secretKeys, keymanagerOps} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: 1,
      validatorClientCount: 1,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
      externalSignerUrl: externalSignerUrl,
    });

    if (keymanagerOps) {
      const keymanagerApi = new KeymanagerApi(
        loggerNodeA,
        validators[0],
        keymanagerOps[0],
        validators[0].genesis.genesisValidatorsRoot,
        "/test/path"
      );

      const kmPort = 10003;

      const keymanagerServer = new KeymanagerServer(
        {host: "127.0.0.1", port: kmPort, cors: "*", auth: false, tokenDir: "."},
        {config, logger: loggerNodeA, api: keymanagerApi}
      );

      await keymanagerServer.listen();

      const client = getKeymanagerClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${kmPort}`}));

      expect((await client.listKeys()).data).to.be.deep.equal([
        {
          validatingPubkey: `${secretKeys[0].toPublicKey().toHex()}`,
          derivationPath: "",
          readonly: true,
        },
      ]);

      expect((await client.deleteKeystores([key1])).data).to.deep.equal([{status: "not_active"}]);

      // clean up
      afterEachCallbacks.push(async () => {
        await Promise.all(validators.map((v) => v.stop()));
        await keymanagerServer.close();
        await bn.close();
      });
    }
  });
});

function dirContainFileWithContent(dir: string, contents: string[]): boolean {
  return fs.readdirSync(dir).some((name) => {
    const fileContent = fs.readFileSync(join(dir, name), {encoding: "utf8"});
    return (
      fileContent !== "" &&
      contents.some((content) => {
        return fileContent.indexOf(content.substring(2)) !== -1;
      })
    );
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createAttesterDuty(pubkey: ByteVector, slot: number, committeeIndex: number, validatorIndex: number) {
  return {
    slot: slot,
    committeeIndex: committeeIndex,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 1,
    validatorIndex: validatorIndex,
    pubkey: pubkey,
  };
}

function createKeymanager(
  vc: Validator,
  slashingProtection: ISlashingProtection,
  importKeystoresPath: string,
  port: number,
  config: IBeaconConfig,
  logger: WinstonLogger
): KeymanagerServer {
  const keymanagerApi = new KeymanagerApi(
    logger,
    vc,
    slashingProtection,
    vc.genesis.genesisValidatorsRoot,
    importKeystoresPath
  );

  return new KeymanagerServer(
    {host: "127.0.0.1", port, cors: "*", auth: false, tokenDir: "."},
    {config, logger: logger, api: keymanagerApi}
  );
}
