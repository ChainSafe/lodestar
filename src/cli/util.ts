import {getCliFields, IConfigurationField, IConfigurationModule, isConfigurationModule} from "../util/config";
import {Command} from "commander";
import {number64} from "../types";

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

export function optionsToConfig(options: {[key: string]: string}, optionDescription: IConfigurationModule): unknown {
  const config = {};
  optionDescription.fields.forEach((field) => {
    if(isConfigurationModule(field)) {
      const childConfig = optionsToConfig(options, field as IConfigurationModule);
      if(Object.keys(childConfig).length > 0) {
        config[field.name] = childConfig;
      }
    } else if(options[(field as IConfigurationField<unknown>).cli.flag]) {
      let value: any = options[(field as IConfigurationField<unknown>).cli.flag];
      if((field as IConfigurationField<unknown>).process) {
        value = (field as IConfigurationField<any>).process(value);
      }
      if(!(field as IConfigurationField<unknown>).validation || (field as IConfigurationField<unknown>).validation(value)) {
        config[field.name] = value;
      }
    }
  });
  return config;
}
