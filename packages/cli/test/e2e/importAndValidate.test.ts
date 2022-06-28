import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex, sleep, retry} from "@chainsafe/lodestar-utils";
import {getClient} from "@chainsafe/lodestar-api/keymanager";
import {config} from "@chainsafe/lodestar-config/default";
import {testFilesDir} from "../utils.js";
import {describeCliTest, execCli} from "../utils/cliRunner.js";
import {getMockBeaconApiServer} from "../utils/mockBeaconApiServer.js";
import {recursiveLookup} from "../../src/util/fs.js";
import {apiTokenFileName} from "../../src/cmds/validator/keymanager/server.js";

/* eslint-disable no-console */

describeCliTest("cmds / validator", function ({spawnCli}) {
  const rootDir = path.join(testFilesDir, "import-and-validate-test");

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
  });

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const skHex = "0x0e5bd52621b6a8956086dcf0ecc89f0cdca56cebb2a8516c2d4252a9867fc551";
  const pkHex = "0x8be678633e927aa0435addad5dcd5283fef6110d91362519cd6d43e61f6c017d724fa579cc4b2972134e050b6ba120c0";
  const passphrase = "AAAAAAAA0000000000";

  it("run 'validator import'", async () => {
    const keystore = await Keystore.create(passphrase, fromHex(skHex), fromHex(pkHex), "");

    fs.mkdirSync(rootDir, {recursive: true});
    const keystoreFilepath = path.join(rootDir, "keystore.json");
    const passphraseFilepath = path.join(rootDir, "password.text");
    fs.writeFileSync(passphraseFilepath, passphrase);
    fs.writeFileSync(keystoreFilepath, keystore.stringify());

    const stdout = await execCli([
      // ⏎
      "validator import",
      `--rootDir ${rootDir}`,
      `--importKeystoresPath ${keystoreFilepath}`,
      `--importKeystoresPassword ${passphraseFilepath}`,
    ]);

    expect(stdout).includes(pkHex, "stdout should include imported pubkey");
  });

  it("run 'validator list' and check pubkeys are imported", async function () {
    fs.mkdirSync(path.join(rootDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(rootDir, "secrets"), {recursive: true});

    const stdout = await execCli([
      // ⏎
      "validator list",
      `--rootDir ${rootDir}`,
    ]);

    // No keys are imported before this test. TODO: Import some
    expect(stdout).includes(pkHex, "stdout should include imported pubkey");
  });

  /**
   * Extends Mocha it() to allow BOTH:
   * - Resolve / reject callback promise to end test
   * - Use done() to end test early
   */
  function itDone(itName: string, cb: (this: Mocha.Context, done: (err?: Error) => void) => Promise<void>): void {
    it(itName, function () {
      return new Promise<void>((resolve, reject) => {
        function done(err?: Error): void {
          if (err) reject(err);
          else resolve();
        }
        cb.bind(this)(done).then(resolve, reject);
      });
    });
  }

  itDone("run 'validator' and ensure validators are ready to sign", async function (done) {
    this.timeout("60s");

    fs.mkdirSync(path.join(rootDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(rootDir, "secrets"), {recursive: true});

    const keymanagerPort = 38011;
    const beaconPort = 39011;
    const keymanagerUrl = `http://localhost:${keymanagerPort}`;
    const beaconUrl = `http://localhost:${beaconPort}`;

    const beaconServer = getMockBeaconApiServer({port: beaconPort});
    afterEachCallbacks.push(() => beaconServer.close());
    await beaconServer.listen();

    const validatorProc = spawnCli([
      // ⏎
      "validator",
      `--rootDir=${rootDir}`,
      "--keymanager.enabled",
      `--keymanager.port=${keymanagerPort}`,
      `--server=${beaconUrl}`,
    ]);
    // Exit early if process exits
    validatorProc.on("exit", (code) => {
      if (code !== null && code > 0) {
        done(Error(`process exited with code ${code}`));
      }
    });

    // Wait for api-token.txt file to be written to disk and find it
    const apiToken = await retry(async () => findApiToken(rootDir), {retryDelay: 500, retries: 10});

    const keymanagerClient = getClient({baseUrl: keymanagerUrl, bearerToken: apiToken}, {config});

    // Wrap in retry since the API may not be listening yet
    const listKeysRes = await retry(() => keymanagerClient.listKeys(), {retryDelay: 500, retries: 10});

    expect(listKeysRes.data).deep.equals(
      [{validatingPubkey: pkHex, derivationPath: "", readonly: false}],
      "Wrong listKeys response data"
    );

    validatorProc.kill("SIGINT");
    await sleep(1000);
    validatorProc.kill("SIGKILL");

    // // No keys are imported before this test. TODO: Import some
    // expect(stdout).includes(pkHex, "stdout should include imported pubkey");
  });
});

function findApiToken(dirpath: string): string {
  const files = recursiveLookup(dirpath);
  const apiTokenFilepaths = files.filter((filepath) => filepath.endsWith(apiTokenFileName));
  switch (apiTokenFilepaths.length) {
    case 0:
      throw Error(`No api token file found in ${dirpath}`);
    case 1:
      return fs.readFileSync(apiTokenFilepaths[0], "utf8").trim();
    default:
      throw Error(`Too many token files found: ${apiTokenFilepaths.join(" ")}`);
  }
}
