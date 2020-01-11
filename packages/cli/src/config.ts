export interface IConfigurationField<T = unknown> {
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

export function booleanOption(name: string, flag: string, description = ""): IConfigurationField {
  return {
    name,
    description,
    type: "boolean",
    configurable: true,
    cli: {
      flag
    }
  };
}

export function getCliFields(configuration: IConfigurationModule): IConfigurationField<unknown>[] {
  const cliFields: IConfigurationField<unknown>[] = [];
  configuration.fields.forEach((field) => {
    if(isConfigurationModule(field)) {
      cliFields.push(...getCliFields(field as IConfigurationModule));
    } else if((field as IConfigurationField<unknown>).cli) {
      cliFields.push(field as IConfigurationField);
    }
  });
  return cliFields;
}

export function validateConfig<T>(config: object, description: IConfigurationModule): Partial<T> {
  const validatedConfiguration: Partial<T> = {};
  for (const prop in config) {
    if (config.hasOwnProperty(prop)) {
      let field = getField(description, prop);
      if (!field) continue;
      if (isConfigurationModule(field)) {
        // @ts-ignore
        validatedConfiguration[prop] = validateConfig(config[prop], field as IConfigurationModule);
      } else {
        field = field as IConfigurationField;
        //TODO: do type conversion/processing
        // @ts-ignore
        if (!field.validation || field.validation(config[prop])) {
          // @ts-ignore
          validatedConfiguration[prop] = config[prop];
        }
      }
    }
  }
  return validatedConfiguration;
}

export function getField(
  description: IConfigurationModule,
  name: string
): IConfigurationModule | IConfigurationField<unknown> | undefined {
  return description.fields.find((field) => {
    return field.name === name;
  });
}

export function isConfigurationModule(field: IConfigurationModule | IConfigurationField<unknown>): boolean {
  return field && !field.hasOwnProperty("type");
}
