export interface IConfigurationField<T> {
  name: string;
  type: T;
  description?: string;
  configurable: boolean;
  validation?: (input: T) => boolean;
  process?: (input: string) => T;
  cli?: {
    flag: string;
    short?: string;
  };
}

export interface IConfigurationModule {
  name: string;
  description?: string;
  fields: (IConfigurationModule | IConfigurationField<unknown>)[];
}

export function getCliFields(configuration: IConfigurationModule): IConfigurationField<unknown>[] {
  const cliFields = [];
  configuration.fields.forEach((field) => {
    if(isConfigurationModule(field)) {
      cliFields.push(...getCliFields(field as IConfigurationModule));
    } else if((field as IConfigurationField<unknown>).cli) {
      cliFields.push(field);
    }
  });
  return cliFields;
}

export function validateConfig(config: object, description: IConfigurationModule): unknown {
  const validatedConfiguration = {};
  for (const prop in config) {
    if (config.hasOwnProperty(prop)) {
      const field = getField(description, prop);
      if (!field) continue;
      if (isConfigurationModule(field)) {
        validatedConfiguration[prop] = validateConfig(config[prop], field as IConfigurationModule);
      } else {
        //TODO: do type conversion/processing
        if (!(field as IConfigurationField<unknown>).validation
          || (field as IConfigurationField<unknown>).validation(config[prop])) {
          validatedConfiguration[prop] = config[prop];
        }
      }
    }
  }
  return validatedConfiguration;
}

export function getField(description: IConfigurationModule, name: string): IConfigurationModule | IConfigurationField<unknown> {
  return description.fields.find((field) => {
    return field.name === name;
  });
}

export function isConfigurationModule(field: IConfigurationModule | IConfigurationField<unknown>): boolean {
  return field && !field.hasOwnProperty('type');
}
