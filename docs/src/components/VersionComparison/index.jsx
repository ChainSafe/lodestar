import React, {useState} from "react";
import semver from "semver";
import Layout from "@theme/Layout";
import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import {useHistory, useLocation} from "@docusaurus/router";
import {
  builderSince,
  cliReferenceUrl,
  commandPaths,
  compareOptions,
  comparisonSelection,
  fieldLabels,
  releasesBetween,
} from "../../utils/cliComparison.mjs";
import styles from "./styles.module.css";

const repository = "https://github.com/ChainSafe/lodestar";
const versionLabel = (id) => (id === "current" ? "Next (unstable)" : `v${id}`);
const gitRef = (id) => (id === "current" ? "unstable" : `v${id}`);

function Value({value}) {
  if (value === null || value === undefined) return <span className={styles.muted}>Not documented</span>;
  if (Array.isArray(value))
    return value.length ? <code>{value.join(", ")}</code> : <span className={styles.muted}>None</span>;
  return <span className={styles.value}>{String(value)}</span>;
}

function Comparison({snapshots, defaultVersion}) {
  const history = useHistory();
  const location = useLocation();
  const baseUrl = useBaseUrl("/");
  const versions = snapshots.map(({id}) => id);
  const {from, to, command, valid} = comparisonSelection(versions, location.search);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const oldSnapshot = snapshots.find(({id}) => id === from);
  const newSnapshot = snapshots.find(({id}) => id === to);
  const changes = valid
    ? compareOptions(oldSnapshot.commands[command], newSnapshot.commands[command], {
        beforeLegacy: oldSnapshot.source === "reference",
        afterLegacy: newSnapshot.source === "reference",
      })
    : null;
  const builderUnavailable =
    command === "builder" &&
    [oldSnapshot, newSnapshot].some(
      (snapshot) =>
        snapshot &&
        !snapshot.commands.builder &&
        snapshot.id !== "current" &&
        semver.lt(snapshot.id, `${builderSince}-0`)
    );
  const legacy = oldSnapshot?.source === "reference" || newSnapshot?.source === "reference";
  const labels = {
    added: legacy ? "Newly documented" : "Added",
    changed: "Changed",
    removed: legacy ? "No longer documented" : "Removed",
  };
  const visibleChanges =
    changes?.filter(
      (change) =>
        (filter === "all" || change.status === filter) &&
        `${change.name} ${change.before?.description ?? ""} ${change.after?.description ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
    ) ?? [];
  const releases = valid ? releasesBetween(versions, from, to) : [];

  function select(next) {
    const params = new URLSearchParams({from, to, command, ...next});
    history.push({pathname: location.pathname, search: `?${params}`});
    setFilter("all");
  }

  const referenceUrl = (version, name) => cliReferenceUrl(baseUrl, defaultVersion, version, command, name);

  return (
    <>
      <div className={styles.selectors}>
        <label>
          From version
          <select value={from} onChange={(event) => select({from: event.target.value})}>
            {!versions.includes(from) && <option value={from}>{from} (unavailable)</option>}
            {versions.map((id) => (
              <option key={id} value={id}>
                {versionLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.swap}
          onClick={() => select({from: to, to: from})}
          aria-label="Swap versions"
        >
          ⇄
        </button>
        <label>
          To version
          <select value={to} onChange={(event) => select({to: event.target.value})}>
            {!versions.includes(to) && <option value={to}>{to} (unavailable)</option>}
            {versions.map((id) => (
              <option key={id} value={id}>
                {versionLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Component
          <select value={command} onChange={(event) => select({command: event.target.value})}>
            {!Object.hasOwn(commandPaths, command) && <option value={command}>{command} (unavailable)</option>}
            <option value="beacon">Beacon node</option>
            <option value="validator">Validator client</option>
            <option value="builder">Builder client</option>
          </select>
        </label>
      </div>
      {!valid ? (
        <div className="alert alert--warning" role="status">
          This version or component is unavailable. Choose from the retained documentation versions above.
        </div>
      ) : (
        <>
          <div className={styles.notice}>
            <strong>{legacy ? "Comparing published CLI documentation" : "Comparing declared CLI options"}</strong>
            <p>
              {legacy
                ? "Older references omit hidden flags, aliases and some defaults, so a difference can be a documentation change only."
                : "Public top-level options, including global options."}
            </p>
            <div className={styles.links}>
              {oldSnapshot.commands[command] && <Link to={referenceUrl(from)}>{versionLabel(from)} CLI reference</Link>}
              {newSnapshot.commands[command] && <Link to={referenceUrl(to)}>{versionLabel(to)} CLI reference</Link>}
              <a href={`${repository}/compare/${gitRef(from)}...${gitRef(to)}`}>View source changes ↗</a>
            </div>
          </div>
          <section className={styles.releases} aria-labelledby="release-notes-title">
            <h2 id="release-notes-title">Release notes</h2>
            <div className={styles.links}>
              {releases.map((version) => (
                <a className={styles.release} key={version} href={`${repository}/releases/tag/v${version}`}>
                  v{version} ↗
                </a>
              ))}
              {releases.length === 0 && (
                <span className={styles.muted}>No intervening releases in this selection.</span>
              )}
            </div>
            {(from === "current" || to === "current") && (
              <p className={styles.muted}>
                Next is unreleased. Check the source changes for work since the latest release.
              </p>
            )}
          </section>
          <section aria-labelledby="cli-changes-title">
            <h2 id="cli-changes-title">CLI option changes</h2>
            {changes === null ? (
              <div className="alert alert--warning" role="status">
                {builderUnavailable
                  ? `The builder client is not available before v${builderSince}.`
                  : "The CLI reference is missing for one of these versions."}
              </div>
            ) : (
              <>
                <div className={styles.toolbar}>
                  <label className={styles.search}>
                    Search options
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Flag name or description"
                    />
                  </label>
                  <div className={styles.filters} aria-label="Filter changes">
                    {["all", "added", "changed", "removed"].map((status) => (
                      <button
                        type="button"
                        key={status}
                        aria-pressed={filter === status}
                        onClick={() => setFilter(status)}
                      >
                        {status === "all" ? "All" : labels[status]}{" "}
                        <span>
                          {status === "all"
                            ? changes.length
                            : changes.filter((change) => change.status === status).length}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className={styles.muted} role="status">
                  {visibleChanges.length} of {changes.length} changed options shown
                </p>
                {visibleChanges.length === 0 && (
                  <div className={styles.empty}>
                    {from === to
                      ? "Choose two different versions to see changes."
                      : changes.length === 0
                        ? "No differences found in the available CLI option data."
                        : "No options match these filters."}
                  </div>
                )}
                {visibleChanges.map((change) => (
                  <article className={styles.card} key={change.name}>
                    <div className={styles.cardHeading}>
                      <h3>
                        <code>--{change.name}</code>
                      </h3>
                      <span className={`${styles.badge} ${styles[change.status]}`}>{labels[change.status]}</span>
                    </div>
                    {change.status === "changed" ? (
                      <div
                        className={styles.tableScroll}
                        role="region"
                        aria-label={`Changes to --${change.name}`}
                        tabIndex={0}
                      >
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Field</th>
                              <th scope="col">{versionLabel(from)}</th>
                              <th scope="col">{versionLabel(to)}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {change.fields.map((field) => (
                              <tr key={field}>
                                <th scope="row">{fieldLabels[field]}</th>
                                <td>
                                  <Value value={change.before[field]} />
                                </td>
                                <td>
                                  <Value value={change.after[field]} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <>
                        <p>{(change.after ?? change.before).description}</p>
                        <dl className={styles.details}>
                          {["type", "default", "choices"].map((field) => (
                            <div key={field}>
                              <dt>{fieldLabels[field]}</dt>
                              <dd>
                                <Value value={(change.after ?? change.before)[field]} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    )}
                    <div className={styles.links}>
                      {change.before && <Link to={referenceUrl(from, change.name)}>Read in {versionLabel(from)}</Link>}
                      {change.after && <Link to={referenceUrl(to, change.name)}>Read in {versionLabel(to)}</Link>}
                    </div>
                  </article>
                ))}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function VersionComparison({comparisonData}) {
  return (
    <Layout
      title="Compare versions"
      description="Compare Lodestar CLI options between releases and review upgrade notes."
    >
      <main className={`container ${styles.page}`}>
        <header className={styles.header}>
          <h1>Compare versions</h1>
          <p className={styles.intro}>See what changed in your CLI options before upgrading.</p>
        </header>
        <BrowserOnly
          fallback={
            <p>
              Enable JavaScript to compare versions. <a href={`${repository}/releases`}>Browse all release notes</a>.
            </p>
          }
        >
          {() => <Comparison {...comparisonData} />}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
