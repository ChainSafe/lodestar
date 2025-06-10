import fs from "node:fs/promises";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {EL_AND_CL_MNEMONIC, SIM_ENV_CHAIN_ID} from "../constants.js";
import {GenesisInfo, IRunner, RunnerType} from "../interfaces.js";

export async function generateGenesisData(
  runner: IRunner,
  forkConfig: ChainForkConfig & {genesisTime: number},
  outputDir: string
): Promise<GenesisInfo> {
  const inputPath = path.join(outputDir, "config", "values.env");
  const outputPath = path.join(outputDir, "output");
  await fs.mkdir(path.dirname(inputPath), {recursive: true});

  const input = {
    // Check following file for more config values
    // https://github.com/ethpandaops/ethereum-genesis-generator/blob/master/defaults/defaults.env
    EL_AND_CL_MNEMONIC,
    CHAIN_ID: String(SIM_ENV_CHAIN_ID as number),
    PRESET_BASE: "minimal",
    SLOT_DURATION_IN_SECONDS: String(forkConfig.SECONDS_PER_SLOT as number),
    NUMBER_OF_VALIDATORS: String(10 as number),
    ALTAIR_FORK_EPOCH: String(forkConfig.ALTAIR_FORK_EPOCH as number),
    BELLATRIX_FORK_EPOCH: String(forkConfig.BELLATRIX_FORK_EPOCH as number),
    CAPELLA_FORK_EPOCH: String(forkConfig.CAPELLA_FORK_EPOCH as number),
    DENEB_FORK_EPOCH: String(forkConfig.DENEB_FORK_EPOCH as number),
    ELECTRA_FORK_EPOCH: String(forkConfig.ELECTRA_FORK_EPOCH as number),
    FULU_FORK_EPOCH: String(forkConfig.FULU_FORK_EPOCH as number),
    GENESIS_DELAY: String(forkConfig.GENESIS_DELAY as number),
    GENESIS_TIMESTAMP: String(forkConfig.genesisTime as number),
  };

  await fs.writeFile(
    inputPath,
    Object.entries(input)
      .map(([key, val]) => (typeof val === "string" ? `export ${key}="${val}";` : `export ${key}=${val};`))
      .join("\n")
  );

  const job = runner.create([
    {
      id: "generate-genesis",
      type: RunnerType.Docker,
      cli: {
        command: "all",
        args: [],
      },
      logs: {stdoutFilePath: path.join(outputDir, "generate-genesis.log")},
      options: {
        image: "ethpandaops/ethereum-genesis-generator:master",
        mounts: [
          [inputPath, "/config/values.env"],
          [outputPath, "/data"],
        ],
      },
    },
  ]);
  await job.start();

  return {
    genesisTime: forkConfig.genesisTime + forkConfig.GENESIS_DELAY,
    jwtSecretPath: path.join(outputDir, "output", "jwt", "jwtsecret"),
    chainSpecPath: path.join(outputDir, "output", "metadata", "chainspec.json"),
    configPath: path.join(outputDir, "output", "metadata", "config.json"),
    genesisJsonPath: path.join(outputDir, "output", "metadata", "genesis.json"),
    genesisSSZPath: path.join(outputDir, "output", "metadata", "genesis.ssz"),
    genesisValidatorRootPath: path.join(outputDir, "output", "metadata", "genesis_validators_root.txt"),
    mnemonicsPath: path.join(outputDir, "output", "metadata", "mnemonics.yaml"),
  };
}
