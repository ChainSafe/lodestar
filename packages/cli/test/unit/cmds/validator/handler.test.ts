import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {ProposerConfig} from "@lodestar/validator";
import {getProposerConfigFromArgs} from "../../../../src/cmds/validator/handler.js";
import {IValidatorCliArgs} from "../../../../src/cmds/validator/options.js";
import {YargsError} from "../../../../src/util/index.js";
import {testFilesDir} from "../../../utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("cmds / validator / getProposerConfigFromArgs", () => {
  const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const pubkey = "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c";
  const validProposerSettingsFile = path.join(__dirname, "../../validator/proposerConfigs/validData.yaml");

  function getProposerConfig(
    args: Partial<IValidatorCliArgs>,
    persistedProposerConfigs: {[index: string]: ProposerConfig} = {}
  ): ReturnType<typeof getProposerConfigFromArgs> {
    return getProposerConfigFromArgs(args as IValidatorCliArgs, {
      persistedKeysBackend: {readProposerConfigs: () => persistedProposerConfigs},
      accountPaths: {proposerDir: "proposerDir"},
    });
  }

  function writeProposerSettingsFile(name: string, content: string): string {
    const filepath = path.join(testFilesDir, name);
    fs.writeFileSync(filepath, content);
    return filepath;
  }

  it("rejects no fee recipient", () => {
    expect(() => getProposerConfig({})).toThrow(YargsError);
    expect(() => getProposerConfig({})).toThrow("--suggestedFeeRecipient");
  });

  it("rejects fee recipients only persisted per validator via the keymanager api", () => {
    expect(() => getProposerConfig({}, {[pubkey]: {feeRecipient}})).toThrow("--suggestedFeeRecipient");
  });

  it("rejects a proposer settings file without default fee recipient", () => {
    const proposerSettingsFile = writeProposerSettingsFile(
      "proposer-settings-no-default-fee-recipient.yaml",
      `proposer_config:\n  "${pubkey}":\n    fee_recipient: "${feeRecipient}"\ndefault_config:\n  graffiti: "default graffiti"\n`
    );

    expect(() => getProposerConfig({proposerSettingsFile})).toThrow("--suggestedFeeRecipient");
  });

  it("accepts --suggestedFeeRecipient", () => {
    const {defaultConfig} = getProposerConfig({suggestedFeeRecipient: feeRecipient});

    expect(defaultConfig.feeRecipient).toBe(feeRecipient);
  });

  it("accepts the zero address if explicitly set", () => {
    const {defaultConfig} = getProposerConfig({suggestedFeeRecipient: zeroAddress});

    expect(defaultConfig.feeRecipient).toBe(zeroAddress);
  });

  it("accepts the default fee recipient of a proposer settings file", () => {
    const {defaultConfig, proposerConfig} = getProposerConfig({proposerSettingsFile: validProposerSettingsFile});

    expect(defaultConfig.feeRecipient).toBe(feeRecipient);
    expect(proposerConfig[pubkey].feeRecipient).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("keeps fee recipients persisted via the keymanager api", () => {
    const persistedFeeRecipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const {defaultConfig, proposerConfig} = getProposerConfig(
      {suggestedFeeRecipient: feeRecipient},
      {[pubkey]: {feeRecipient: persistedFeeRecipient}}
    );

    expect(defaultConfig.feeRecipient).toBe(feeRecipient);
    expect(proposerConfig[pubkey].feeRecipient).toBe(persistedFeeRecipient);
  });
});
