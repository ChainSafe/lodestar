import React from "react";
import pkg from "../../package.json";

export default function Footer(): JSX.Element {
  return (
    <footer>
      <div className="content has-text-centered">
        Made with ❤️ by{" "}
        <a className="is-link has-text-danger is-family-code" href="https://chainsafe.io">
          ChainSafe Systems
        </a>
        <br />
      </div>
      <div className="content has-text-centered is-small is-family-code">
        <div>
          <a className="is-link has-text-grey" href="https://www.npmjs.com/package/@chainsafe/lodestar">
            @chainsafe/lodestar {pkg.dependencies["@chainsafe/lodestar-config"]}
          </a>
        </div>
      </div>
    </footer>
  );
}
