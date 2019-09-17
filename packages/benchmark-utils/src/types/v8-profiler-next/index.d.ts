declare module "v8-profile-next" {

    interface ProfileResult {
        export(profile: (error: Error, result: string) => void): void;
    }

    export default class {
        static startProfiling(profileId: string): void;
        static stopProfiling(profileId: string): ProfileResult;
    }
}