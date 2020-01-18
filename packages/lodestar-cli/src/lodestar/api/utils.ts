import {ApiNamespace} from "@chainsafe/lodestar/lib/api";

export const processApiNamespaces = (input: string): ApiNamespace[] => {
  return input
    .split(",")
    .map(((api: string) => {
      if(api.trim() === ApiNamespace.BEACON) {
        return ApiNamespace.BEACON;
      } else {
        return ApiNamespace.VALIDATOR;
      }
    }));
};