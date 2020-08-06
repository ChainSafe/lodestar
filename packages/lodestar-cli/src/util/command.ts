import {Options, Argv} from "yargs";

export type ICliCommandOptions<OwnOptions> = Required<{[key in keyof OwnOptions]: Options}>;

export interface ICliCommand<OwnOptions = {}, ParentOptions = {}> {
  command: string;
  describe: string;
  options?: ICliCommandOptions<OwnOptions>;
  // 1st arg: any = free own sub command options
  // 2nd arg: subcommand parent options is = to this command options + parent options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subcommands?: ICliCommand<any, OwnOptions & ParentOptions>[];
  handler: (args: OwnOptions & ParentOptions) => void;
}

/**
 * Register a ICliCommand type to yargs. Recursively registers subcommands too.
 * @param yargs
 * @param cliCommand
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerCommandToYargs(yargs: Argv, cliCommand: ICliCommand<any, any>): void {
  yargs.command({
    command: cliCommand.command,
    describe: cliCommand.describe,
    builder: (yargsBuilder) => {
      yargsBuilder.options(cliCommand.options || {});
      for (const subcommand of cliCommand.subcommands || []) {
        registerCommandToYargs(yargsBuilder, subcommand);
      }
      return yargs;
    },
    handler: cliCommand.handler
  });
}
