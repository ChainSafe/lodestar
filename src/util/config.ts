export interface IConfigurationField<T> {
  name: string;
  type: T;
  description?: string;
  configurable: boolean;
  validation?: (input: T) => boolean;
  cli?: {
    flag: string;
    short?: string;
  };
}

export interface IConfigurationModule {
  name: string;
  description?: string;
  fields: (IConfigurationModule | IConfigurationField<any>)[];
}
