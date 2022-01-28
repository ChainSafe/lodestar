import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {getAccountPaths} from "../../../src/cmds/account/paths";
import {ReturnType as WalletCreateReturnType} from "../../../src/cmds/account/cmds/wallet/create";
import {ReturnType as WalletListReturnType} from "../../../src/cmds/account/cmds/wallet/list";
import {ReturnType as ValidatorCreateReturnType} from "../../../src/cmds/account/cmds/validator/create";
import {ReturnType as ValidatorListReturnType} from "../../../src/cmds/account/cmds/validator/list";
import {VOTING_KEYSTORE_FILE, getValidatorDirPath} from "../../../src/validatorDir/paths";
import {testFilesDir} from "../../utils";
import {getLodestarCliTestRunner} from "../commandRunner";

/* eslint-disable no-console */

type ConsoleKeys = "log" | "warn" | "error";
const consoleKeys: ConsoleKeys[] = ["log", "warn", "error"];

describe("cmds / account", function () {
  const lodestar = getLodestarCliTestRunner();

  const rootDir = testFilesDir;
  const walletName = "primary";
  const walletPasswordPath = path.join(testFilesDir, "primary.pass");
  const validatorCount = 2;
  const accountPaths = getAccountPaths({rootDir});
  let createdPubkeys: string[] | null = null;

  const consoleData: {[P in ConsoleKeys]: string} = {
    log: "",
    warn: "",
    error: "",
  };
  const consoleCache: {[P in ConsoleKeys]: typeof console.log} = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  beforeEach("Hijack console", () => {
    for (const key of consoleKeys) {
      consoleData[key] = "";
      console[key] = (...args: any[]) => {
        consoleData.log += args.map(String).join(" ");
      };
    }
  });

  afterEach("Release console", () => {
    for (const key of consoleKeys) {
      console[key] = consoleCache[key];
    }
  });

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
  });

  it("should create a wallet", async function () {
    const {mnemonic, uuid, password} = await lodestar<WalletCreateReturnType>([
      "account wallet create",
      `--name ${walletName}`,
      `--passphraseFile ${walletPasswordPath}`,
      `--rootDir ${rootDir}`,
    ]);

    expect(mnemonic, "Empty mnemonic").to.be.ok;

    // Assert that the password file contains a password
    const passwordInFile = fs.readFileSync(walletPasswordPath, "utf8");
    expect(passwordInFile.trim()).to.equal(password, "Wrong password stored in disk");

    // Assert the wallet directory is created
    const walletDirs = fs.readdirSync(accountPaths.walletsDir);
    expect(walletDirs).to.deep.equal([uuid], "Wallet dir should contain one wallet with it UUID");
  });

  it("should list existing wallets", async function () {
    // Should return an array of wallet names
    const walletNames = await lodestar<WalletListReturnType>([
      // ⏎
      "account wallet list",
      `--rootDir ${rootDir}`,
    ]);
    expect(walletNames).to.deep.equal([walletName]);
  });

  it("should create new validators", async function () {
    const pubkeys = await lodestar<ValidatorCreateReturnType>([
      "account validator create",
      `--count ${validatorCount}`,
      `--name ${walletName}`,
      `--passphraseFile ${walletPasswordPath}`,
      `--rootDir ${rootDir}`,
    ]);
    // For next test
    createdPubkeys = pubkeys;

    expect(pubkeys).length(validatorCount, `Should create ${validatorCount} validators`);

    for (const pubkey of pubkeys) {
      const validatorDir = getValidatorDirPath({
        keystoresDir: accountPaths.keystoresDir,
        pubkey,
        prefixed: true,
      });
      const keystorePath = path.join(validatorDir, VOTING_KEYSTORE_FILE);
      expect(fs.existsSync(keystorePath), `Validator keystore ${keystorePath} does not exist`).to.be.true;
    }
  });

  it("should list validators", async function () {
    if (!createdPubkeys) throw Error("Previous test failed");

    const validatorPubKeys = await lodestar<ValidatorListReturnType>([
      // ⏎
      "account validator list",
      `--rootDir ${rootDir}`,
    ]);

    // Write order is not guarranteed, sort before comparing
    expect(validatorPubKeys.sort()).to.deep.equal(createdPubkeys.sort(), "Wrong validator pubkeys");
  });
});
