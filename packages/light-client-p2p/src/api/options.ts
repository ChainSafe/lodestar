export interface IApiOptions {
  maxGindicesInProof?: number;
  version?: string;
}

export const defaultApiOptions: IApiOptions = {
  maxGindicesInProof: 512,
  version: "dev",
};
