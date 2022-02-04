import {IChainConfig, chainConfigToJson} from "@chainsafe/lodestar-config";

export class NotEqualParamsError extends Error {}

/**
 * Assert localConfig values match externalSpecJson. externalSpecJson may contain more values than localConfig.
 */
export function assertEqualParams(localConfig: IChainConfig, externalSpecJson: Record<string, string>): void {
  const params1Json = chainConfigToJson(localConfig) as Record<string, unknown>;
  const params2Json = externalSpecJson;

  const errors: string[] = [];

  // Ensure only that the localConfig values match the remote spec
  for (const key of Object.keys(params1Json)) {
    if (params1Json[key] !== params2Json[key])
      errors.push(`${key} different value: ${params1Json[key]} != ${params2Json[key]}`);
  }

  if (errors.length > 0) {
    throw new NotEqualParamsError("Not equal BeaconParams\n" + errors.join("\n"));
  }
}
