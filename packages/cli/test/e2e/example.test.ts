import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex} from "@chainsafe/lodestar-utils";
import {ReturnType as ValidatorListReturnType} from "../../src/cmds/validator/list.js";
import {testFilesDir} from "../utils.js";
import {getCliInMemoryRunner} from "../utils/inMemoryRunner.js";

/* eslint-disable no-console */

type ConsoleKeys = "log" | "warn" | "error";
const consoleKeys: ConsoleKeys[] = ["log", "warn", "error"];

describe("cmds / validator", function () {
  const lodestar = getCliInMemoryRunner();

  const rootDir = testFilesDir;

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

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const skHex = "0x0e5bd52621b6a8956086dcf0ecc89f0cdca56cebb2a8516c2d4252a9867fc551";
  const pkHex = "0x8be678633e927aa0435addad5dcd5283fef6110d91362519cd6d43e61f6c017d724fa579cc4b2972134e050b6ba120c0";

  it("Should import validator keystore", async () => {
    const passphrase = "AAAAAAAA0000000000";
    const keystore = await Keystore.create(passphrase, fromHex(skHex), fromHex(pkHex), "");

    fs.mkdirSync(rootDir, {recursive: true});
    const keystoreFilepath = path.join(rootDir, "keystore.json");
    const passphraseFilepath = path.join(rootDir, "password.text");
    fs.writeFileSync(passphraseFilepath, passphrase);
    fs.writeFileSync(keystoreFilepath, keystore.stringify());

    const res = await lodestar<ValidatorListReturnType>([
      // ⏎
      "validator import",
      `--rootDir ${rootDir}`,
      `--keystore ${keystoreFilepath}`,
      `--passphraseFile ${passphraseFilepath}`,
    ]);

    console.log(res);
  });

  it("should list validators", async function () {
    fs.mkdirSync(path.join(rootDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(rootDir, "secrets"), {recursive: true});

    const validatorPubKeys = await lodestar<ValidatorListReturnType>([
      // ⏎
      "validator list",
      `--rootDir ${rootDir}`,
    ]);

    // No keys are imported before this test. TODO: Import some
    expect(validatorPubKeys.sort()).to.deep.equal([pkHex], "Wrong validator pubkeys");
  });
});
