import path from "node:path";
import {describe, it, beforeAll, vi} from "vitest";
import {rimraf} from "rimraf";
import {Interchange} from "@lodestar/validator";
import {ApiError} from "@lodestar/api";
import {getKeystoresStr} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectDeepEquals} from "../utils/runUtils.js";
import {startValidatorWithKeyManager} from "../utils/validator.js";

describe("import keystores from api, test DefaultProposerConfig", function () {
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
    /* eslint-disable @typescript-eslint/naming-convention */
    metadata: {
      interchange_format_version: "5",
      genesis_validators_root: genesisValidatorsRoot,
    },
    data: [],
  };
  const slashingProtectionStr = JSON.stringify(slashingProtection);

  it("1 . run 'validator' import keys from API, getdefaultfeeRecipient", async () => {
    const {keymanagerClient} = await startValidatorWithKeyManager([`--graffiti ${defaultOptions.graffiti}`], {
      dataDir,
    });
    // Produce and encrypt keystores
    // Import test keys
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);
    await keymanagerClient.importKeystores(keystoresStr, passphrases, slashingProtectionStr);

    //////////////// Fee Recipient

    let feeRecipient0 = await keymanagerClient.listFeeRecipient(pubkeys[0]);
    ApiError.assert(feeRecipient0);
    expectDeepEquals(
      feeRecipient0.response.data,
      {pubkey: pubkeys[0], ethaddress: defaultOptions.suggestedFeeRecipient},
      "FeeRecipient Check default"
    );

    // Set feeClient to updatedOptions
    ApiError.assert(await keymanagerClient.setFeeRecipient(pubkeys[0], updatedOptions.suggestedFeeRecipient));
    feeRecipient0 = await keymanagerClient.listFeeRecipient(pubkeys[0]);
    ApiError.assert(feeRecipient0);
    expectDeepEquals(
      feeRecipient0.response.data,
      {pubkey: pubkeys[0], ethaddress: updatedOptions.suggestedFeeRecipient},
      "FeeRecipient Check updated"
    );

    //////////////// Graffiti

    let graffiti0 = await keymanagerClient.listGraffiti(pubkeys[0]);
    ApiError.assert(graffiti0);
    expectDeepEquals(
      graffiti0.response.data,
      {pubkey: pubkeys[0], graffiti: defaultOptions.graffiti},
      "Graffiti Check default"
    );

    // Set Graffiti to updatedOptions
    ApiError.assert(await keymanagerClient.setGraffiti(pubkeys[0], updatedOptions.graffiti));
    graffiti0 = await keymanagerClient.listGraffiti(pubkeys[0]);
    ApiError.assert(graffiti0);
    expectDeepEquals(
      graffiti0.response.data,
      {pubkey: pubkeys[0], graffiti: updatedOptions.graffiti},
      "FeeRecipient Check updated"
    );

    /////////// GasLimit

    let gasLimit0 = await keymanagerClient.getGasLimit(pubkeys[0]);
    ApiError.assert(gasLimit0);
    expectDeepEquals(
      gasLimit0.response.data,
      {pubkey: pubkeys[0], gasLimit: defaultOptions.gasLimit},
      "gasLimit Check default"
    );

    // Set GasLimit to updatedOptions
    ApiError.assert(await keymanagerClient.setGasLimit(pubkeys[0], updatedOptions.gasLimit));
    gasLimit0 = await keymanagerClient.getGasLimit(pubkeys[0]);
    ApiError.assert(gasLimit0);
    expectDeepEquals(
      gasLimit0.response.data,
      {pubkey: pubkeys[0], gasLimit: updatedOptions.gasLimit},
      "gasLimit Check updated"
    );
  });

  it("2 . run 'validator' Check last feeRecipient and gasLimit persists", async () => {
    const {keymanagerClient} = await startValidatorWithKeyManager([`--graffiti ${defaultOptions.graffiti}`], {
      dataDir,
    });

    // next time check edited feeRecipient persists
    let feeRecipient0 = await keymanagerClient.listFeeRecipient(pubkeys[0]);
    ApiError.assert(feeRecipient0);
    expectDeepEquals(
      feeRecipient0.response.data,
      {pubkey: pubkeys[0], ethaddress: updatedOptions.suggestedFeeRecipient},
      "FeeRecipient Check default persists"
    );

    // after deletion  feeRecipient restored to default
    ApiError.assert(await keymanagerClient.deleteFeeRecipient(pubkeys[0]));
    feeRecipient0 = await keymanagerClient.listFeeRecipient(pubkeys[0]);
    ApiError.assert(feeRecipient0);
    expectDeepEquals(
      feeRecipient0.response.data,
      {pubkey: pubkeys[0], ethaddress: defaultOptions.suggestedFeeRecipient},
      "FeeRecipient Check default after delete"
    );

    // graffiti persists
    let graffiti0 = await keymanagerClient.listGraffiti(pubkeys[0]);
    ApiError.assert(graffiti0);
    expectDeepEquals(
      graffiti0.response.data,
      {pubkey: pubkeys[0], graffiti: updatedOptions.graffiti},
      "FeeRecipient Check default persists"
    );

    // after deletion  graffiti restored to default
    ApiError.assert(await keymanagerClient.deleteGraffiti(pubkeys[0]));
    graffiti0 = await keymanagerClient.listGraffiti(pubkeys[0]);
    ApiError.assert(graffiti0);
    expectDeepEquals(
      graffiti0.response.data,
      {pubkey: pubkeys[0], graffiti: defaultOptions.graffiti},
      "FeeRecipient Check default after delete"
    );

    // gasLimit persists
    let gasLimit0 = await keymanagerClient.getGasLimit(pubkeys[0]);
    ApiError.assert(gasLimit0);
    expectDeepEquals(
      gasLimit0.response.data,
      {pubkey: pubkeys[0], gasLimit: updatedOptions.gasLimit},
      "gasLimit Check updated persists"
    );

    ApiError.assert(await keymanagerClient.deleteGasLimit(pubkeys[0]));
    gasLimit0 = await keymanagerClient.getGasLimit(pubkeys[0]);
    ApiError.assert(gasLimit0);
    expectDeepEquals(
      gasLimit0.response.data,
      {pubkey: pubkeys[0], gasLimit: defaultOptions.gasLimit},
      "gasLimit Check default after  delete"
    );
  });

  it("3 . run 'validator' FeeRecipient and GasLimit should be default after delete", async () => {
    const {keymanagerClient} = await startValidatorWithKeyManager([`--graffiti ${defaultOptions.graffiti}`], {
      dataDir,
    });

    const feeRecipient0 = await keymanagerClient.listFeeRecipient(pubkeys[0]);
    ApiError.assert(feeRecipient0);
    expectDeepEquals(
      feeRecipient0.response.data,
      {pubkey: pubkeys[0], ethaddress: defaultOptions.suggestedFeeRecipient},
      "FeeRecipient Check default persists"
    );

    ApiError.assert(await keymanagerClient.deleteGraffiti(pubkeys[0]));
    const graffiti0 = await keymanagerClient.listGraffiti(pubkeys[0]);
    ApiError.assert(graffiti0);
    expectDeepEquals(
      graffiti0.response.data,
      {pubkey: pubkeys[0], graffiti: defaultOptions.graffiti},
      "FeeRecipient Check default persists"
    );

    ApiError.assert(await keymanagerClient.deleteGasLimit(pubkeys[0]));
    const gasLimit0 = await keymanagerClient.getGasLimit(pubkeys[0]);
    ApiError.assert(gasLimit0);
    expectDeepEquals(
      gasLimit0.response.data,
      {pubkey: pubkeys[0], gasLimit: defaultOptions.gasLimit},
      "gasLimit Check default after  delete"
    );
  });
});
