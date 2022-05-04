import {IChainConfig, chainConfigToJson} from "@chainsafe/lodestar-config";

export class NotEqualParamsError extends Error {}

/**
 * Assert localConfig values match externalSpecJson. externalSpecJson may contain more values than localConfig.
 */
export function assertEqualParams(localConfig: IChainConfig, remoteConfigJson: Record<string, string>): void {
  const localConfigJson = chainConfigToJson(localConfig) as Record<string, unknown>;

  const errors: string[] = [];

  // Ensure only that the localConfig values match the remote spec
  for (const key of Object.keys(localConfigJson)) {
    if (
      (localConfigJson[key] as string)?.toLocaleLowerCase() !== (remoteConfigJson[key] as string)?.toLocaleLowerCase()
    )
      errors.push(`${key} different value: ${localConfigJson[key]} != ${remoteConfigJson[key]}`);
  }

  if (errors.length > 0) {
    throw new NotEqualParamsError("Not equal BeaconParams\n" + errors.join("\n"));
  }
}
