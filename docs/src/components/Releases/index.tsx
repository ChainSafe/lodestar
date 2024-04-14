import React, {useEffect, useState} from "react";

export type Asset = {
  // eslint-disable-next-line prettier/prettier, @typescript-eslint/naming-convention
  browser_download_url: string;
  id: number;
  name: string;
};

export type Release = {
  id: number;
  name: string;
  // eslint-disable-next-line prettier/prettier, @typescript-eslint/naming-convention
  published_at: string;
  assets: Asset[];
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/naming-convention
export function Releases({repository}: {repository: string}) {
  const [releases, setReleases] = useState([]);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${repository}/releases`)
      .then((response) => response.json())
      .then(setReleases)
      .catch(() => setReleases([]));
  });

  if (releases.length === 0) {
    return <div>No releases</div>;
  } else {
    return (
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Release Date</th>
            <th>Downloads</th>
          </tr>
        </thead>
        <tbody>
          {releases &&
            releases.map((release) => (
              <tr key={release.id}>
                <td>{release.name}</td>
                <td>{release.published_at}</td>
                <td>
                  {release.assets.map((asset) => (
                    <a key={asset.id} href={asset.browser_download_url}>
                      <div>{asset.name}</div>
                    </a>
                  ))}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }
}
