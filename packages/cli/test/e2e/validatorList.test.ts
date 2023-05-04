/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import {rimraf} from "rimraf";
import {expect} from "chai";
import sinon from "sinon";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex} from "@lodestar/utils";
import {testFilesDir} from "../utils.js";
import {getCliInMemoryRunner} from "../utils/inMemoryRunner.js";

describe("cmds / validator", function () {
  const lodestar = getCliInMemoryRunner();

  const dataDir = testFilesDir;

  beforeEach(() => {
    sinon.spy(console, "info");
    sinon.spy(console, "log");
  });

  afterEach(() => {
    sinon.restore();
  });

  before("Clean dataDir", () => {
    rimraf.sync(dataDir);
  });

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const skHex = "0x0e5bd52621b6a8956086dcf0ecc89f0cdca56cebb2a8516c2d4252a9867fc551";
  const pkHex = "0x8be678633e927aa0435addad5dcd5283fef6110d91362519cd6d43e61f6c017d724fa579cc4b2972134e050b6ba120c0";

  it("Should import validator keystore", async () => {
    const passphrase = "AAAAAAAA0000000000";
    const keystore = await Keystore.create(passphrase, fromHex(skHex), fromHex(pkHex), "");

    fs.mkdirSync(dataDir, {recursive: true});
    const keystoreFilepath = path.join(dataDir, "keystore.json");
    const passphraseFilepath = path.join(dataDir, "password.text");
    fs.writeFileSync(passphraseFilepath, passphrase);
    fs.writeFileSync(keystoreFilepath, keystore.stringify());

    await lodestar([
      "validator import",
      `--dataDir ${dataDir}`,
      `--keystore ${keystoreFilepath}`,
      `--passphraseFile ${passphraseFilepath}`,
    ]);

    expect(console.log).be.calledWith(`Imported keystore ${pkHex} ${keystoreFilepath}`);
  });

  it("should list validators", async function () {
    fs.mkdirSync(path.join(dataDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(dataDir, "secrets"), {recursive: true});

    await lodestar(["validator list", `--dataDir ${dataDir}`]);

    expect(console.info).calledWith("1 local keystores");
    expect(console.info).calledWith(pkHex);
  });
});
