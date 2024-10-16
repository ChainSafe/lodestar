import path from "node:path";
import {describe, it, beforeAll, vi, onTestFinished} from "vitest";
import {rimraf} from "rimraf";
import {ImportStatus} from "@lodestar/api/keymanager";
import {Interchange} from "@lodestar/validator";
import {getKeystoresStr} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals} from "../utils/runUtils.js";
import {startValidatorWithKeyManager} from "../utils/validator.js";

describe("import keystores from api, test DefaultProposerConfig", () => {
  vi.setConfig({testTimeout: 30_000});

  const dataDir = path.join(testFilesDir, "proposer-config-test");

  const defaultOptions = {
    suggestedFeeRecipient: "0x0000000000000000000000000000000000000000",
    gasLimit: 30_000_000,
    graffiti: "aaaa",
  };

  const updatedOptions = {
    suggestedFeeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
    gasLimit: 35_000_000,
    graffiti: "bbbb",
  };

  beforeAll(() => {
    rimraf.sync(dataDir);
  });

  /** Generated from  const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa)); */
  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);
  const passphrases = pubkeys.map((_) => passphrase);

  const genesisValidatorsRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const slashingProtection: Interchange = {
    metadata: {
      interchange_format_version: "5",
      genesis_validators_root: genesisValidatorsRoot,
    },
    data: [],
  };
  const slashingProtectionStr = JSON.stringify(slashingProtection);

  it("1 . run 'validator' import keys from API, getdefaultfeeRecipient", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager(
      [`--graffiti ${defaultOptions.graffiti}`],
      {
        dataDir,
      }
    );
    onTestFinished(async () => {
      await stopValidator();
    });

    // Produce and encrypt keystores
    // Import test keys
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);
    const importRes = await keymanagerClient.importKeystores({
      keystores: keystoresStr,
      passwords: passphrases,
      slashingProtection: slashingProtectionStr,
    });
    expectDeepEquals(
      importRes.value(),
      keystoresStr.map(() => ({status: ImportStatus.imported})),
      "Wrong importKeystores response"
    );

    //////////////// Fee Recipient

    let feeRecipient0 = (await keymanagerClient.listFeeRecipient({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      feeRecipient0,
      {pubkey: pubkeys[0], ethaddress: defaultOptions.suggestedFeeRecipient},
      "FeeRecipient Check default"
    );

    // Set feeClient to updatedOptions
    (
      await keymanagerClient.setFeeRecipient({pubkey: pubkeys[0], ethaddress: updatedOptions.suggestedFeeRecipient})
    ).assertOk();
    feeRecipient0 = (await keymanagerClient.listFeeRecipient({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      feeRecipient0,
      {pubkey: pubkeys[0], ethaddress: updatedOptions.suggestedFeeRecipient},
      "FeeRecipient Check updated"
    );

    //////////////// Graffiti

    let graffiti0 = (await keymanagerClient.getGraffiti({pubkey: pubkeys[0]})).value();
    expectDeepEquals(graffiti0, {pubkey: pubkeys[0], graffiti: defaultOptions.graffiti}, "Graffiti Check default");

    // Set Graffiti to updatedOptions
    (await keymanagerClient.setGraffiti({pubkey: pubkeys[0], graffiti: updatedOptions.graffiti})).assertOk();
    graffiti0 = (await keymanagerClient.getGraffiti({pubkey: pubkeys[0]})).value();
    expectDeepEquals(graffiti0, {pubkey: pubkeys[0], graffiti: updatedOptions.graffiti}, "FeeRecipient Check updated");

    /////////// GasLimit

    let gasLimit0 = (await keymanagerClient.getGasLimit({pubkey: pubkeys[0]})).value();
    expectDeepEquals(gasLimit0, {pubkey: pubkeys[0], gasLimit: defaultOptions.gasLimit}, "gasLimit Check default");

    // Set GasLimit to updatedOptions
    (await keymanagerClient.setGasLimit({pubkey: pubkeys[0], gasLimit: updatedOptions.gasLimit})).assertOk();
    gasLimit0 = (await keymanagerClient.getGasLimit({pubkey: pubkeys[0]})).value();
    expectDeepEquals(gasLimit0, {pubkey: pubkeys[0], gasLimit: updatedOptions.gasLimit}, "gasLimit Check updated");
  });

  it("2 . run 'validator' Check last feeRecipient and gasLimit persists", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager(
      [`--graffiti ${defaultOptions.graffiti}`],
      {
        dataDir,
      }
    );
    onTestFinished(async () => {
      await stopValidator();
    });

    // next time check edited feeRecipient persists
    let feeRecipient0 = (await keymanagerClient.listFeeRecipient({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      feeRecipient0,
      {pubkey: pubkeys[0], ethaddress: updatedOptions.suggestedFeeRecipient},
      "FeeRecipient Check default persists"
    );

    // after deletion  feeRecipient restored to default
    (await keymanagerClient.deleteFeeRecipient({pubkey: pubkeys[0]})).assertOk();
    feeRecipient0 = (await keymanagerClient.listFeeRecipient({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      feeRecipient0,
      {pubkey: pubkeys[0], ethaddress: defaultOptions.suggestedFeeRecipient},
      "FeeRecipient Check default after delete"
    );

    // graffiti persists
    let graffiti0 = (await keymanagerClient.getGraffiti({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      graffiti0,
      {pubkey: pubkeys[0], graffiti: updatedOptions.graffiti},
      "FeeRecipient Check default persists"
    );

    // after deletion  graffiti restored to default
    (await keymanagerClient.deleteGraffiti({pubkey: pubkeys[0]})).assertOk();
    graffiti0 = (await keymanagerClient.getGraffiti({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      graffiti0,
      {pubkey: pubkeys[0], graffiti: defaultOptions.graffiti},
      "FeeRecipient Check default after delete"
    );

    // gasLimit persists
    let gasLimit0 = (await keymanagerClient.getGasLimit({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      gasLimit0,
      {pubkey: pubkeys[0], gasLimit: updatedOptions.gasLimit},
      "gasLimit Check updated persists"
    );

    (await keymanagerClient.deleteGasLimit({pubkey: pubkeys[0]})).assertOk();
    gasLimit0 = (await keymanagerClient.getGasLimit({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      gasLimit0,
      {pubkey: pubkeys[0], gasLimit: defaultOptions.gasLimit},
      "gasLimit Check default after  delete"
    );
  });

  it("3 . run 'validator' FeeRecipient and GasLimit should be default after delete", async () => {
    const {keymanagerClient, stopValidator} = await startValidatorWithKeyManager(
      [`--graffiti ${defaultOptions.graffiti}`],
      {
        dataDir,
      }
    );
    onTestFinished(async () => {
      await stopValidator();
    });

    const feeRecipient0 = (await keymanagerClient.listFeeRecipient({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      feeRecipient0,
      {pubkey: pubkeys[0], ethaddress: defaultOptions.suggestedFeeRecipient},
      "FeeRecipient Check default persists"
    );

    (await keymanagerClient.deleteGraffiti({pubkey: pubkeys[0]})).assertOk();
    const graffiti0 = (await keymanagerClient.getGraffiti({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      graffiti0,
      {pubkey: pubkeys[0], graffiti: defaultOptions.graffiti},
      "FeeRecipient Check default persists"
    );

    (await keymanagerClient.deleteGasLimit({pubkey: pubkeys[0]})).assertOk();
    const gasLimit0 = (await keymanagerClient.getGasLimit({pubkey: pubkeys[0]})).value();
    expectDeepEquals(
      gasLimit0,
      {pubkey: pubkeys[0], gasLimit: defaultOptions.gasLimit},
      "gasLimit Check default after  delete"
    );
  });
});
