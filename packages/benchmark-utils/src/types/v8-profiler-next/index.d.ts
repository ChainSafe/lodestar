declare module "v8-profile-next" {

  interface IProfileResult {
    export(profile: (error: Error, result: string) => void): void;
  }

  export default class {
    public static startProfiling(profileId: string): void;
    public static stopProfiling(profileId: string): IProfileResult;
  }
}