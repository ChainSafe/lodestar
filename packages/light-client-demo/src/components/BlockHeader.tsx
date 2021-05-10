import React from "react";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";

export function BlockHeader({config, header}: {config: IBeaconConfig; header: altair.BeaconBlockHeader}): JSX.Element {
  const BeaconBlockHeader = config.types.altair.BeaconBlockHeader;
  const json = BeaconBlockHeader.toJson(header);
  return (
    <div className="beacon-header">
      {Object.keys(BeaconBlockHeader.fields).map((fieldName) => (
        <div key={fieldName} className="beacon-header-item columns">
          <div className="beacon-header-key column is-one-third">
            {fieldName}
          </div>
          <div className="beacon-header-value column is-two-thirds">
            {json[fieldName]}
          </div>
        </div>
      ))}
    </div>
  );
}
