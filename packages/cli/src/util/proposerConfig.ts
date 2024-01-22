/* eslint-disable @typescript-eslint/naming-convention */

import fs from "node:fs";
import path from "node:path";
import {ValidatorProposerConfig} from "@lodestar/validator";
import {routes} from "@lodestar/api";

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
  const {gas_limit, selection: builderSelection} = builder || {};

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

  return {
    graffiti: overrideConfig?.graffiti ?? graffiti,
    strictFeeRecipientCheck:
      overrideConfig?.strictFeeRecipientCheck ??
      (strict_fee_recipient_check ? stringtoBool(strict_fee_recipient_check) : undefined),
    feeRecipient: overrideConfig?.feeRecipient ?? (fee_recipient ? parseFeeRecipient(fee_recipient) : undefined),
    builder: {
      gasLimit: overrideConfig?.builder?.gasLimit ?? (gas_limit !== undefined ? Number(gas_limit) : undefined),
      selection: overrideConfig?.builder?.selection ?? builderSelection,
    },
  };
}

export function readProposerConfigDir(filepath: string, filename: string): ProposerConfigFileSection {
  const proposerConfigStr = fs.readFileSync(path.join(filepath, filename), "utf8");
  const proposerConfigJSON = JSON.parse(proposerConfigStr) as ProposerConfigFileSection;
  return proposerConfigJSON;
}
