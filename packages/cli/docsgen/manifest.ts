import {CliCommand, CliCommandOptions, CliOptionDefinition} from "@lodestar/utils";

export type CliOptionManifest = {
  name: string;
  description: string;
  type: string | null;
  default: string | null;
  choices: string[];
  aliases: string[];
  required: boolean;
  deprecated: string | boolean;
};

export type CliManifest = {
  schemaVersion: 1;
  commands: Record<string, CliOptionManifest[]>;
};

export function formatDefault(option: CliOptionDefinition): string | null {
  const value: unknown = option.defaultDescription ?? option.default;
  if (value === undefined) return null;
  let formatted = String(value);
  if (option.type === "string" || option.string) formatted = `"${formatted}"`;
  if (option.type === "array" && !formatted.startsWith("[")) {
    if (formatted === "") formatted = "[]";
    else if (formatted.includes('"')) formatted = `[ ${formatted} ]`;
    else formatted = `[ "${formatted}" ]`;
  }
  return formatted;
}

export function createCliManifest(
  commands: Pick<CliCommand, "command" | "options">[],
  globalOptions: CliCommandOptions<Record<never, never>>
): CliManifest {
  return {
    schemaVersion: 1,
    commands: Object.fromEntries(
      commands
        .filter(({command}) => command === "beacon" || command === "validator" || command === "builder")
        .map(({command, options}) => [
          command,
          Object.entries({...globalOptions, ...options})
            .filter(([, definition]) => !(definition as CliOptionDefinition).hidden)
            .map(([name, definition]) => {
              const option = definition as CliOptionDefinition;
              return {
                name,
                description: String(option.description ?? option.describe ?? ""),
                type: option.type === "array" ? "string[]" : option.type ?? null,
                default: formatDefault(option),
                choices: option.choices?.map(String).sort() ?? [],
                aliases: [option.alias ?? []].flat().sort(),
                required: Boolean(option.demandOption),
                deprecated: option.deprecated ?? false,
              };
            }),
        ])
    ),
  };
}
