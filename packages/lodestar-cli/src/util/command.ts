import {Options, Argv} from "yargs";

export type ICliCommandOptions<OwnArgs> = Required<{[key in keyof OwnArgs]: Options}>;

export interface ICliCommand<OwnArgs = {}, ParentArgs = {}> {
  command: string;
  describe: string;
  options?: ICliCommandOptions<OwnArgs>;
  // 1st arg: any = free own sub command options
  // 2nd arg: subcommand parent options is = to this command options + parent options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subcommands?: ICliCommand<any, OwnArgs & ParentArgs>[];
  handler?: (args: OwnArgs & ParentArgs) => void;
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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    handler: cliCommand.handler || function emptyHandler(): void {}
  });
}
