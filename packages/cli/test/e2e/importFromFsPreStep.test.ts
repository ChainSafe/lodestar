import fs from "node:fs";
import path from "node:path";
import rimraf from "rimraf";
import {expect} from "chai";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex, sleep, retry} from "@chainsafe/lodestar-utils";
import {getClient} from "@chainsafe/lodestar-api/keymanager";
import {config} from "@chainsafe/lodestar-config/default";
import {testFilesDir} from "../utils.js";
import {describeCliTest, execCli} from "../utils/childprocRunner.js";
import {getMockBeaconApiServer} from "../utils/mockBeaconApiServer.js";
import {findApiToken, getAfterEachCallbacks, itDone} from "../utils/runUtils.js";
import {pubkeysHex, seckeysHex} from "../utils/cachedKeys.js";

/* eslint-disable no-console */

describeCliTest("import from fs then validate", function ({spawnCli}) {
  const rootDir = path.join(testFilesDir, "import-then-validate-test");

  before("Clean rootDir", () => {
    rimraf.sync(rootDir);
  });

  const afterEachCallbacks = getAfterEachCallbacks();

  const skHex = pubkeysHex[0];
  const pkHex = seckeysHex[0];
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

  itDone("run 'validator' and ensure validators are ready to sign", async function (done) {
    this.timeout("60s");

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
  });
});
