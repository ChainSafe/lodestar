import type {cmds} from "../src/cmds/index.js";
import {CliOptionDefinition, CliCommand, CliExample, CliCommandOptions} from "../src/util/index.js";
import {toKebab} from "./changeCase.js";

const DEFAULT_SEPARATOR = "\n\n";
const LINE_BREAK = "\n\n<br />";

function renderExampleBody(example: CliExample, lodestarCommand?: string): string {
  const cliExample = [
    `\`\`\`
${lodestarCommand ? `${lodestarCommand} ` : ""}${example.command}
\`\`\``,
  ];

  if (example.description) {
    cliExample.unshift(example.description);
  }

  return cliExample.join(DEFAULT_SEPARATOR);
}

/**
 * Renders a single example like shown below.  Title and description are optional.
 * -------------------
 * #### Basic `validator` command example
 *
 * Run one validator client with all the keystores available in the directory .goerli/keystores
 *
 * ```
 * validator --network goerli
 * ```
 * -------------------
 */
function renderCommandExample(example: CliExample, lodestarCommand?: string): string {
  const title = example.title ? `#### ${example.title}${DEFAULT_SEPARATOR}` : "";
  return title.concat(renderExampleBody(example, lodestarCommand));
}

/**
 * Renders a example section like shown below
 * -------------------
 * ## Examples
 *
 * #### Basic `validator` command example
 *
 * Run one validator client with all the keystores available in the directory .goerli/keystores
 *
 * ```
 * validator --network goerli
 * ```
 *
 * #### Advanced `validator` command example
 *
 * Run one validator client with all the keystores available in the directory .goerli/keystores
 * using an rcConfig file for configuration
 *
 * ```
 * validator --rcConfig validator-dir/validator.rcconfig.yaml
 * ```
 * -------------------
 */
function renderExamples(examples: CliExample[], sectionTitle?: string, lodestarCommand?: string): string {
  const exampleSection = [sectionTitle];
  for (const example of examples) {
    exampleSection.push(renderCommandExample(example, lodestarCommand));
  }
  return exampleSection.filter(Boolean).join(DEFAULT_SEPARATOR);
}

/**
 * Renders a single cli option like shown below
 * -------------------
 * #### `--logLevel`
 *
 * Logging verbosity level for emitting logs to terminal
 *
 * type: string
 * default: info
 * choices: "error", "warn", "info", "verbose", "debug"
 * example: Set log level to debug
 *
 * ```
 * validator --logLevel debug
 * ```
 * -------------------
 */
function renderOption(optionName: string, option: CliOptionDefinition): string | undefined {
  if (option.hidden) return;

  const commandOption = [`#### \`--${optionName}\``];
  if (option.description) commandOption.push(`description: ${option.description}`);

  if (option.demandOption === true) {
    commandOption.push("required: true");
  }

  if (option.type === "array") {
    commandOption.push("type: string[]");
  } else if (option.type) {
    commandOption.push(`type: ${option.type}`);
  }

  if (option.choices) {
    commandOption.push(`choices: ${option.choices.map((c) => `"${c}"`).join(", ")}`);
  }

  let defaultValue = String(option.defaultDescription || option.default || "");
  if (defaultValue) {
    if (option.type === "string" || option.string) {
      defaultValue = `"${defaultValue}"`;
    }
    commandOption.push(`default: ${defaultValue}`);
  }

  if (option.example) {
    commandOption.push(`example: ${renderExampleBody(option.example)}`);
  }

  return commandOption.join(DEFAULT_SEPARATOR).concat(LINE_BREAK);
}

function renderOptions(options: CliCommandOptions<Record<never, never>>, title: string, description?: string): string {
  const optionsSection = [title, description];
  for (const [name, option] of Object.entries(options)) {
    const optionString = renderOption(name, option as CliOptionDefinition);
    // Skip hidden options
    if (optionString) {
      optionsSection.push(optionString);
    }
  }
  return optionsSection.filter(Boolean).join(DEFAULT_SEPARATOR);
}

function getSubCommands(cmd: (typeof cmds)[number]): CliCommand<unknown, unknown, unknown>[] {
  const subCommands = [];
  if (cmd.subcommands) {
    for (const sub of cmd.subcommands) {
      subCommands.push(sub, ...getSubCommands(sub));
    }
  }
  return subCommands;
}

function renderSubCommandsList(command: string, subCommands: CliCommand<unknown, unknown, unknown>[]): string {
  const list = [
    `## Available Sub-Commands

The following sub-commands are available with the \`${command}\` command:`,
  ];

  for (const sub of subCommands) {
    list.push(`- [${sub.command}](#${toKebab(sub.command)})`);
  }

  return list.join("\n");
}

/**
 * ## `validator slashing-protection import`
 *
 * Import an interchange file from another client
 *
 * #### `validator slashing-protection import` Options
 *
 * `--file`
 *
 * The slashing protection interchange file to import (.json).
 *
 * type: string
 * required: true
 *
 * #### Sub-Command Examples
 *
 * Import an interchange file to the slashing protection DB
 *
 * ```
 * ./lodestar validator slashing-protection import --network goerli --file interchange.json
 * ```
 */
function renderSingleSubCommand(
  command: string,
  description?: string,
  options?: CliCommandOptions<Record<never, never>>,
  examples?: CliExample[],
  lodestarCommand?: string
): string {
  const subCommand = [`## \`${command}\``];

  if (description) {
    subCommand.push(description);
  }

  if (examples) {
    subCommand.push(renderExamples(examples, `### \`${command}\` Examples`, lodestarCommand));
  }

  if (options) {
    subCommand.push(
      renderOptions(
        options,
        `### \`${command}\` Options`,
        "_Supports all parent command options plus the following:_\n\n<br>"
      )
    );
  }

  return subCommand.join(DEFAULT_SEPARATOR);
}

function renderSubCommand(
  rootCommand: string,
  sub: CliCommand<unknown, unknown, unknown>,
  lodestarCommand?: string
): string {
  const subCommand = [];

  if (sub.command.includes("<command>")) {
    // If subcommand is a nested subcommand recursively render each of its subcommands by
    // merging its props with its nested children but do not render the subcommand itself
    for (const subSub of sub.subcommands ?? []) {
      subCommand.push(
        renderSubCommand(rootCommand, {
          ...subSub,
          command: sub.command.replace("<command>", subSub.command),
          options: {
            ...(sub.options ?? {}),
            ...(subSub.options ?? {}),
          },
          examples: sub.examples?.concat(subSub.examples ?? []),
        })
      );
    }
  } else {
    // If subcommand is not nested build actual markdown
    subCommand.push(
      renderSingleSubCommand(`${rootCommand} ${sub.command}`, sub.describe, sub.options, sub.examples, lodestarCommand)
    );

    // render any sub-subcommands
    if (sub.subcommands) {
      for (const subSub of sub.subcommands) {
        subCommand.push(renderSubCommand(`${rootCommand} ${sub.command}`, subSub));
      }
    }
  }

  return subCommand.join(DEFAULT_SEPARATOR);
}

export function renderCommandPage(
  cmd: (typeof cmds)[number],
  globalOptions: CliCommandOptions<Record<never, never>>,
  lodestarCommand?: string
): string {
  const page = [`# \`${cmd.command}\` CLI Command`, cmd.describe];

  const subCommands = getSubCommands(cmd);
  if (subCommands.length > 0) {
    page.push(renderSubCommandsList(cmd.command, subCommands));
  }

  if (cmd.examples) {
    page.push(renderExamples(cmd.examples, "## Examples", lodestarCommand));
  }

  if (cmd.options) {
    page.push(renderOptions({...globalOptions, ...cmd.options}, `## \`${cmd.command}\` Options`));
  }

  if (subCommands.length > 0) {
    for (const sub of subCommands) {
      page.push(renderSubCommand(cmd.command, sub, lodestarCommand));
    }
  }

  return page.join(LINE_BREAK.concat(DEFAULT_SEPARATOR));
}

// /**
//  * Render an array of objects as a markdown table
//  */
// export function toMarkdownTable<T extends {[key: string]: string}>(rows: T[], headers: (keyof T)[]): string {
//   return [
//     toMarkdownTableRow(headers as string[]),
//     toMarkdownTableRow(headers.map(() => "---")),
//     ...rows.map((row) => toMarkdownTableRow(headers.map((key) => row[key]))),
//   ].join("\n");
// }

// /**
//  * Render an array of items as a markdown table row
//  */
// export function toMarkdownTableRow(row: string[]): string {
//   return `| ${row.join(" | ")} |`;
// }