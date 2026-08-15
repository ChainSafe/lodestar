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
    min_bid?: bigint;
    max_execution_payment?: bigint;
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
  const {gas_limit, selection: builderSelection, boost_factor, min_bid, max_execution_payment} = builder || {};

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
  if (min_bid !== undefined && typeof min_bid !== "string") {
    throw Error("min_bid is not 'string");
  }
  if (max_execution_payment !== undefined && typeof max_execution_payment !== "string") {
    throw Error("max_execution_payment is not 'string");
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
            minBid: overrideConfig?.builder?.minBid ?? parseBuilderMinBid(min_bid),
            maxExecutionPayment:
              overrideConfig?.builder?.maxExecutionPayment ?? parseBuilderGweiAmount(max_execution_payment),
            urls: overrideConfig?.builder?.urls,
          }
        : undefined,
  };
}

export function readProposerConfigDir(filepath: string, filename: string): ProposerConfig {
  const proposerConfigStr = fs.readFileSync(path.join(filepath, filename), "utf8");
  // Persisted via `writeProposerConfig` with BigInt values serialized as strings
  const persisted = JSON.parse(proposerConfigStr) as ProposerConfig;
  if (persisted.builder) {
    const {boostFactor, minBid, maxExecutionPayment, builders} = persisted.builder;
    persisted.builder.boostFactor = boostFactor !== undefined ? BigInt(boostFactor) : undefined;
    persisted.builder.minBid = minBid !== undefined ? BigInt(minBid) : undefined;
    persisted.builder.maxExecutionPayment = maxExecutionPayment !== undefined ? BigInt(maxExecutionPayment) : undefined;
    persisted.builder.builders = builders?.map((entry) => ({
      ...entry,
      maxExecutionPayment: entry.maxExecutionPayment !== undefined ? BigInt(entry.maxExecutionPayment) : undefined,
      minBid: entry.minBid !== undefined ? BigInt(entry.minBid) : undefined,
      builderBoostFactor: entry.builderBoostFactor !== undefined ? BigInt(entry.builderBoostFactor) : undefined,
    }));
  }
  return persisted;
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
        throw Error("Builder selection builderonly is no longer supported, use builderalways instead");
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

export function parseBuilderMinBid(minBid?: string | bigint): bigint | undefined {
  if (minBid === undefined) return;

  if (!/^\d+$/.test(minBid.toString())) {
    throw Error("Invalid input for builder min bid, must be a valid number without decimals");
  }

  return BigInt(minBid);
}

export function parseBuilderGweiAmount(amount?: string | bigint): bigint | undefined {
  if (amount === undefined) return;

  if (!/^\d+$/.test(amount.toString())) {
    throw Error("Invalid input for builder Gwei amount, must be a valid number without decimals");
  }

  return BigInt(amount);
}

export function parseBuilderUrls(urls?: string[]): string[] | undefined {
  if (urls === undefined) return undefined;

  for (const url of urls) {
    try {
      new URL(url);
    } catch {
      throw Error(`Invalid builder url: ${url}`);
    }
  }
  return [...new Set(urls)];
}
