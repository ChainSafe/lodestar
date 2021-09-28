import {load, FAILSAFE_SCHEMA, Type} from "js-yaml";

export function loadConfigYaml(configYaml: string): Record<string, unknown> {
  return load(configYaml, {schema}) as Record<string, unknown>;
}

export const schema = FAILSAFE_SCHEMA.extend({
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return data !== null ? data : "";
      },
    }),
  ],
});
