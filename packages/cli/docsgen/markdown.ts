import {CliOptionDefinition, CliCommand, CliExample, CliCommandOptions} from "@lodestar/utils";
import {toKebab} from "./changeCase.js";

const DEFAULT_SEPARATOR = "\n\n";
const LINE_BREAK = "\n\n";

function sanitizeDescription(description: string): string {
  return description
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function renderExampleBody(example: CliExample, lodestarCommand?: string): string {
  const cliExample = [
    `\`\`\`sh
${lodestarCommand ? `${lodestarCommand} ` : ""}${example.command}
\`\`\``,
  ];

  if (example.description) {
    cliExample.unshift(sanitizeDescription(example.description));
  }

  return cliExample.join(DEFAULT_SEPARATOR);
}

/**
 * Renders a single example like shown below.  Title and description are optional.
 * -------------------
 * #### Basic `validator` command example
 *
 * Run one validator client with all the keystores available in the directory .holesky/keystores
 *
 * ```
 * validator --network holesky
 * ```
 * -------------------
 */
function renderCommandExample(example: CliExample, lodestarCommand?: string): string {
  const title = example.title ? `### ${example.title}${DEFAULT_SEPARATOR}` : "";
  return title.concat(renderExampleBody(example, lodestarCommand));
}

/**
 * Renders a example section like shown below
 * -------------------
 * ## Examples
 *
 * #### Basic `validator` command example
 *
 * Run one validator client with all the keystores available in the directory .holesky/keystores
 *
 * ```
 * validator --network holesky
 * ```
 *
 * #### Advanced `validator` command example
 *
 * Run one validator client with all the keystores available in the directory .holesky/keystores
 * using an rcConfig file for configuration
 *
 * ```
 * validator --rcConfig validator-dir/validator.rcconfig.yaml
 * ```
 * -------------------
 */
function renderExamplesSection(examples: CliExample[], sectionTitle?: string, lodestarCommand?: string): string {
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
  if (option.description) commandOption.push(`${sanitizeDescription(option.description)}`);

  if (option.demandOption === true) {
    commandOption.push("required: true");
  }

  if (option.type === "array") {
    commandOption.push("type: `string[]`");
  } else if (option.type) {
    commandOption.push(`type: \`${option.type}\``);
  }

  if (option.choices) {
    commandOption.push(`choices: ${option.choices.map((c) => `"${c}"`).join(", ")}`);
  }

  let defaultValue = String(option.defaultDescription || option.default || "");
  if (defaultValue) {
    if (option.type === "string" || option.string) {
      defaultValue = `"${defaultValue}"`;
    }
    if (option.type === "array") {
      if (!defaultValue.includes(`"`)) {
        defaultValue = `"${defaultValue}"`;
      }
      if (!defaultValue.startsWith("[")) {
        defaultValue = `[ ${defaultValue} ]`;
      }
    }
    commandOption.push(`default: \`${defaultValue}\``);
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

interface SubCommandDefinition {
  command: string;
  description?: string;
  options?: CliCommandOptions<Record<never, never>>;
  examples?: CliExample[];
}

function renderSubCommandsList(command: string, subCommands: SubCommandDefinition[]): string {
  const list = [
    `## Available Sub-Commands

The following sub-commands are available with the \`${command}\` command:`,
  ];

  for (const sub of subCommands) {
    list.push(`- [${sub.command}](#${toKebab(sub.command)})`);
  }

  return list.join(DEFAULT_SEPARATOR);
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
 * ./lodestar validator slashing-protection import --network holesky --file interchange.json
 * ```
 */
function renderSubCommand(sub: SubCommandDefinition, lodestarCommand?: string): string {
  const subCommand = [`## \`${sub.command}\``];

  if (sub.description) {
    subCommand.push(sub.description);
  }

  if (sub.examples) {
    subCommand.push(renderExamplesSection(sub.examples, `### \`${sub.command}\` Examples`, lodestarCommand));
  }

  if (sub.options) {
    subCommand.push(
      renderOptions(
        sub.options,
        `### \`${sub.command}\` Options`,
        "_Supports all parent command options plus the following:_\n\n"
      )
    );
  }

  return subCommand.join(DEFAULT_SEPARATOR);
}

function getSubCommands(rootCommand: string, sub: CliCommand<unknown, unknown, unknown>): SubCommandDefinition[] {
  const subCommands = [] as SubCommandDefinition[];

  if (sub.command.includes("<command>")) {
    // If subcommand is a nested subcommand recursively render each of its subcommands by
    // merging its props with its nested children but do not render the subcommand itself
    for (const subSub of sub.subcommands ?? []) {
      subCommands.push(
        ...getSubCommands(rootCommand, {
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
    subCommands.push({
      command: `${rootCommand} ${sub.command}`,
      description: sub.describe,
      options: sub.options,
      examples: sub.examples,
    });

    // render any sub-subcommands
    if (sub.subcommands) {
      for (const subSub of sub.subcommands) {
        subCommands.push(...getSubCommands(`${rootCommand} ${sub.command}`, subSub));
      }
    }
  }

  return subCommands;
}

export function renderCommandPage(
  cmd: CliCommand<unknown, unknown, unknown>,
  globalOptions: CliCommandOptions<Record<never, never>>,
  lodestarCommand?: string
): string {
  const page = [`---\ntitle: CLI Reference\n---\n\n# \`${cmd.command}\` CLI Command`, cmd.describe];

  const subCommands = (cmd.subcommands ?? []).map((sub) => getSubCommands(cmd.command, sub)).flat();
  if (subCommands.length > 0) {
    page.push(renderSubCommandsList(cmd.command, subCommands));
  }

  if (cmd.examples) {
    page.push(renderExamplesSection(cmd.examples, "## Examples", lodestarCommand));
  }

  if (cmd.options) {
    page.push(renderOptions({...globalOptions, ...cmd.options}, `## \`${cmd.command}\` Options`));
  }

  if (subCommands.length > 0) {
    for (const sub of subCommands) {
      page.push(renderSubCommand(sub, lodestarCommand));
    }
  }

  return page.join(LINE_BREAK.concat(DEFAULT_SEPARATOR));
}
