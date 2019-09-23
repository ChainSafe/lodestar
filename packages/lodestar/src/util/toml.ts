import {IConfigurationField, IConfigurationModule, isConfigurationModule} from "./config";
import {JsonMap} from "@iarna/toml";

export function generateTomlConfig(config: object, description: IConfigurationModule): JsonMap {
  const json = {};
  description.fields.forEach((field) => {

    // @ts-ignore
    if (!config[field.name]) {
      return;
    }

    if (isConfigurationModule(field)) {
      // @ts-ignore
      const content = generateTomlConfig(config[field.name], field as IConfigurationModule);
      if (content && Object.keys(content).length > 0) {
        // @ts-ignore
        json[field.name] = content;
      }
    } else if ((field as IConfigurationField<unknown>).configurable) {
      // @ts-ignore
      json[field.name] = config[field.name];
    }
  });
  return json;
}
