import {Options, Argv} from "yargs";

export type ICliCommandOptions<OwnArgs> = Required<{[key in keyof OwnArgs]: Options}>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ICliCommand<OwnArgs = Record<never, never>, ParentArgs = Record<never, never>, R = any> {
  command: string;
  describe: string;
  examples?: {command: string; description: string}[];
  options?: ICliCommandOptions<OwnArgs>;
  // 1st arg: any = free own sub command options
  // 2nd arg: subcommand parent options is = to this command options + parent options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subcommands?: ICliCommand<any, OwnArgs & ParentArgs>[];
  handler?: (args: OwnArgs & ParentArgs) => Promise<R>;
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
      if (cliCommand.examples) {
        for (const example of cliCommand.examples) {
          yargsBuilder.example(`$0 ${example.command}`, example.description);
        }
      }
      return yargs;
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    handler: cliCommand.handler || function emptyHandler(): void {},
  });
}
