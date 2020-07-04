import {Argv} from "yargs";

import {mergeOptions} from "../../../util";
import {IGlobalArgs} from "../../../options";

import * as validatorDir from "./validatorDir";
import * as validatorFile from "./validatorFile";
import * as chain from "../../dev/options/chain";
import * as server from "./server";

export interface IValidatorCliArgs extends 
  validatorFile.IValidatorFileArgs, 
  chain.IChainArgs, 
  server.IServerArgs {}

export function mergeValidatorOptions(yargs: Argv<IGlobalArgs>): Argv<IValidatorCliArgs> {
  return mergeOptions(
    mergeOptions(
      mergeOptions(yargs, validatorDir),
      validatorFile),
    {...chain, ...server}
  );
}
