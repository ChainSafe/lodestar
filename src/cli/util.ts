import {getCliFields, IConfigurationField, IConfigurationModule, isConfigurationModule} from "../util/config";
import {Command} from "commander";

export function generateCommanderOptions(command: Command, optionDescription: IConfigurationModule): void {
  const cliOptions = getCliFields(optionDescription);
  cliOptions.forEach((cliOption) => {
    let flag = "";
    if(cliOption.cli.short) {
      flag += `-${cliOption.cli.short}, `;
    }
    flag += `--${cliOption.cli.flag}`;
    if(cliOption.type != Boolean) {
      flag = flag + ` <${cliOption.name}>`;
    }
    const defaultProcess = (arg) => {
      return arg;
    };
    command.option(flag, cliOption.description, cliOption.process || defaultProcess);

  });
}

/**
 * This is awful,
 * @param options
 * @param optionDescription
 */
export function optionsToConfig<T>(options: {[key: string]: string}, optionDescription: IConfigurationModule): Partial<T> {
  const config = {};
  optionDescription.fields.forEach((field) => {
    if (isConfigurationModule(field)) {
      processModule(options, field, config);
    } else {
      processField(field, options, config);
    }
  });
  return config;
}

function processModule(options: { [p: string]: string }, field, config) {
  const childConfig = optionsToConfig(options, field as IConfigurationModule);
  if (Object.keys(childConfig).length > 0) {
    config[field.name] = childConfig;
  }
}

function processField(field, options: { [p: string]: string }, config) {
  field = field as IConfigurationField<unknown>;
  if (field.cli && options[field.cli.flag]) {
    let value: any = options[field.cli.flag];
    if (field.process && typeof value === 'string') {
      value = field.process(value);
    }
    if (!field.validation || field.validation(value)) {
      config[field.name] = value;
    }
  }
  return field;
}
