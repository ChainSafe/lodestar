import {Arguments} from "yargs";

import {IBeaconArgs} from "../../options";

import {init} from "./init";

export const command = "init";

export const description = "Initialize beacon node";

export const builder = {};

export async function handler(args: Arguments<IBeaconArgs>): Promise<void> {
  await init(args);
}
