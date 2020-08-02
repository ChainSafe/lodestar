import {existsSync} from "fs";
import {Json} from "@chainsafe/ssz";
import {BeaconParams} from "@chainsafe/lodestar-params";
import {IBeaconConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";

import {writeFile, readFile} from "../util";

export async function writeParamsConfig(filename: string, config: IBeaconConfig): Promise<void> {
  await writeFile(filename, BeaconParams.toJson(config.params));
}

export async function readParamsConfig(filename: string): Promise<IBeaconConfig> {
  if (existsSync(filename)) {
    const jsonParams = await readFile(filename) as Json;
    return createIBeaconConfig(BeaconParams.fromJson(jsonParams));
  }
  throw new Error(`${filename} does not exist`);
}
