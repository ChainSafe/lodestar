import {IConfigurationField, IConfigurationModule} from "./config";
import {AnySSZType} from "@chainsafe/ssz";
import {JsonMap} from "@iarna/toml";

export function generateTomlConfig(config: object, description: IConfigurationModule): JsonMap {
  const json = {};
  description.fields.forEach((field) => {

    if (!config[field.name]) {
      return;
    }

    if (isConfigurationModule(field)) {
      const content = generateTomlConfig(config[field.name], field as IConfigurationModule);
      if (content && Object.keys(content).length > 0) {
        json[field.name] = content;
      }
    } else if ((field as IConfigurationField<any>).configurable) {
      json[field.name] = config[field.name];
    }
  });
  return json;
}

export function validateConfig(config: object, description: IConfigurationModule): any {
  const validatedConfiguration = {};
  for (const prop in config) {
    if (config.hasOwnProperty(prop)) {
      const field = getField(description, prop);
      if (!field) continue;
      if (isConfigurationModule(field)) {
        validatedConfiguration[prop] = validateConfig(config[prop], field as IConfigurationModule);
      } else {
        //TODO: do type conversion/processing
        if (!(field as IConfigurationField<any>).validation
          || (field as IConfigurationField<any>).validation(config[prop])) {
          validatedConfiguration[prop] = config[prop];
        }
      }
    }
  }
  return validatedConfiguration;
}

function getField(description: IConfigurationModule, name: string): IConfigurationModule | IConfigurationField<any> {
  return description.fields.find((field) => {
    return field.name === name;
  });
}

function isConfigurationModule(field: IConfigurationModule | IConfigurationField<AnySSZType>): boolean {
  return field && !field.hasOwnProperty('type');
}
