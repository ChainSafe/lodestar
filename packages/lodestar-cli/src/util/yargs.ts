import {Options} from "yargs";

export interface IYargsOptionWithName extends Options {
  name: string;
}

export type IYargsOptionsMap = Record<string, Options>;