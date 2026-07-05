import fs from "node:fs";
import path from "node:path";
import {routes} from "@lodestar/api";
import {ValidatorProposerConfig} from "@lodestar/validator";
import {parseFeeRecipient} from "./feeRecipient.js";
import {readFile} from "./file.js";

type ProposerConfig = ValidatorProposerConfig["defaultConfig"];

type ProposerConfigFileSection = {
  graffiti?: string;
  strict_fee_recipient_check?: string;
  fee_recipient?: string;
  builder?: {
    // boolean are parse as string by the default schema readFile employs
    // for js-yaml
    gas_limit?: number;
    selection?: routes.validator.BuilderSelection;
    boost_factor?: bigint;
    max_execution_payment?: string;
    builders?: {[url: string]: {max_execution_payment?: string} | null};
  };
};

type ProposerConfigFile = {
  proposer_config?: {[index: string]: ProposerConfigFileSection};
  default_config?: ProposerConfigFileSection;
};

export function parseProposerConfig(
  configFilePath: string,
  defaultArgsConfig?: ProposerConfig
): ValidatorProposerConfig {
  const configFile = readFile<ProposerConfigFile>(configFilePath, ["yml", "yaml"]);
  const defaultConfigParsed = parseProposerConfigSection(configFile.default_config || {}, defaultArgsConfig);

  const proposerConfigFile = configFile.proposer_config || {};
  const proposerConfigParsed: ValidatorProposerConfig["proposerConfig"] = {};
  for (const pubkeyHex of Object.keys(proposerConfigFile)) {
    proposerConfigParsed[pubkeyHex] = parseProposerConfigSection(proposerConfigFile[pubkeyHex]);
  }

  return {
    proposerConfig: proposerConfigParsed,
    defaultConfig: defaultConfigParsed,
  };
}

function stringtoBool(input: string): boolean {
  const boolValue = typeof input === "string" ? input === "true" : input;
  return boolValue;
}

function parseProposerConfigSection(
  proposerFileSection: ProposerConfigFileSection,
  overrideConfig?: ProposerConfig
): ProposerConfig {
  const {graffiti, strict_fee_recipient_check, fee_recipient, builder} = proposerFileSection;
  const {gas_limit, selection: builderSelection, boost_factor, max_execution_payment, builders} = builder || {};

  if (graffiti !== undefined && typeof graffiti !== "string") {
    throw Error("graffiti is not 'string");
  }
  if (
    strict_fee_recipient_check !== undefined &&
    !(strict_fee_recipient_check === "true" || strict_fee_recipient_check === "false")
  ) {
    throw Error("strict_fee_recipient_check is not set to boolean");
  }
  if (fee_recipient !== undefined && typeof fee_recipient !== "string") {
    throw Error("fee_recipient is not 'string");
  }
  if (gas_limit !== undefined) {
    if (typeof gas_limit !== "string") {
      throw Error("(typeof gas_limit !== 'string') 2 ");
    }
    if (Number.isNaN(Number(gas_limit))) {
      throw Error("(Number.isNaN(Number(gas_limit)) 2");
    }
  }
  if (boost_factor !== undefined && typeof boost_factor !== "string") {
    throw Error("boost_factor is not 'string");
  }

  return {
    graffiti: overrideConfig?.graffiti ?? graffiti,
    strictFeeRecipientCheck:
      overrideConfig?.strictFeeRecipientCheck ??
      (strict_fee_recipient_check ? stringtoBool(strict_fee_recipient_check) : undefined),
    feeRecipient: overrideConfig?.feeRecipient ?? (fee_recipient ? parseFeeRecipient(fee_recipient) : undefined),
    builder:
      overrideConfig?.builder || builder
        ? {
            gasLimit: overrideConfig?.builder?.gasLimit ?? (gas_limit !== undefined ? Number(gas_limit) : undefined),
            selection: overrideConfig?.builder?.selection ?? parseBuilderSelection(builderSelection),
            boostFactor: overrideConfig?.builder?.boostFactor ?? parseBuilderBoostFactor(boost_factor),
            maxExecutionPayment:
              overrideConfig?.builder?.maxExecutionPayment ?? parseMaxExecutionPayment(max_execution_payment),
            builders: overrideConfig?.builder?.builders ?? parseBuilders(builders),
          }
        : undefined,
  };
}

function parseBuilders(builders?: {
  [url: string]: {max_execution_payment?: string} | null;
}): Record<string, {maxExecutionPayment?: bigint}> | undefined {
  if (builders === undefined) return undefined;

  const parsed: Record<string, {maxExecutionPayment?: bigint}> = {};
  for (const [url, preferences] of Object.entries(builders)) {
    parseBuilderUrl(url);
    parsed[url] = {maxExecutionPayment: parseMaxExecutionPayment(preferences?.max_execution_payment)};
  }
  return parsed;
}

export function readProposerConfigDir(filepath: string, filename: string): ProposerConfigFileSection {
  const proposerConfigStr = fs.readFileSync(path.join(filepath, filename), "utf8");
  const proposerConfigJSON = JSON.parse(proposerConfigStr) as ProposerConfigFileSection;
  return proposerConfigJSON;
}

export function parseBuilderSelection(builderSelection?: string): routes.validator.BuilderSelection | undefined {
  if (builderSelection) {
    switch (builderSelection) {
      case "default":
        break;
      case "maxprofit":
        break;
      case "builderalways":
        break;
      case "builderonly":
        break;
      case "executionalways":
        break;
      case "executiononly":
        break;
      default:
        throw Error("Invalid input for builder selection, check help");
    }
  }
  return builderSelection as routes.validator.BuilderSelection;
}

export function parseBuilderBoostFactor(boostFactor?: string): bigint | undefined {
  if (boostFactor === undefined) return;

  if (!/^\d+$/.test(boostFactor)) {
    throw Error("Invalid input for builder boost factor, must be a valid number without decimals");
  }

  return BigInt(boostFactor);
}

export function parseMaxExecutionPayment(maxExecutionPayment?: string): bigint | undefined {
  if (maxExecutionPayment === undefined) return;

  if (!/^\d+$/.test(maxExecutionPayment)) {
    throw Error("Invalid input for max execution payment, must be a valid number in Gwei without decimals");
  }

  return BigInt(maxExecutionPayment);
}

export function parseBuilderUrls(urls?: string[]): Record<string, {maxExecutionPayment?: bigint}> | undefined {
  if (urls === undefined) return undefined;

  const builders: Record<string, {maxExecutionPayment?: bigint}> = {};
  for (const url of urls) {
    builders[parseBuilderUrl(url)] = {};
  }
  return builders;
}

function parseBuilderUrl(url: string): string {
  try {
    new URL(url);
  } catch {
    throw Error(`Invalid builder url: ${url}`);
  }
  return url;
}
