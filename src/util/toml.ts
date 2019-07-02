import {IConfigurationField, IConfigurationModule} from "./config";
import {AnySSZType} from "@chainsafe/ssz";
import {JsonMap} from "@iarna/toml";

export function generateTomlConfig(config: object, description: IConfigurationModule): JsonMap {
  const json = {};
  description.fields.forEach((field) => {

    if(!config[field.name]) {
      return;
    }

    if(isConfigurationModule(field)) {
      const content = generateTomlConfig(config[field.name], field as IConfigurationModule);
      if(content && Object.keys(content).length > 0) {
        json[field.name] = content;
      }
    } else if ((field as IConfigurationField<any>).configurable) {
      json[field.name] = config[field.name];
    }
  });
  return json;
}

function isConfigurationModule(field: IConfigurationModule | IConfigurationField<AnySSZType>): boolean {
  return !field.hasOwnProperty('type');
}
