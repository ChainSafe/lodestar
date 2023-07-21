/* eslint-disable
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/naming-convention,
  import/no-extraneous-dependencies,
  no-console
*/

import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import dotenv from "dotenv";
import {lintGrafanaDashboard, readGrafanaDashboard, writeGrafanaDashboard} from "./lint-grafana-dashboard.mjs";

// Usage:
//
// Create a file `.secrets.env` with envs
// ```
// GRAFANA_API_KEY=$token
// GRAFANA_URL=https://yourgrafanaapi.io
// ```
//
// Run
// ```
// node scripts/download_dashboards.mjs
// ```
//
// Check git diff of resulting files, commit, push and open PR

// load environment variables from .env file
dotenv.config({path: ".secrets.env"});

const OUTDIR = "./dashboards";
const UID_PREFIX_WHITELIST = "lodestar_";
const {GRAFANA_API_KEY, GRAFANA_URL} = process.env;

if (!GRAFANA_API_KEY) throw Error("GRAFANA_API_KEY not set");
if (!GRAFANA_URL) throw Error("GRAFANA_URL not set");

// Fetch all dashboard uids
/** @type {{data: DashboardMeta[]}} */
const dashboardListRes = await axios.get(`${GRAFANA_URL}/api/search`, {
  headers: {Authorization: `Bearer ${GRAFANA_API_KEY}`},
});

// Iterate through each dashboard uid and download the dashboard data
for (const dashboardMeta of dashboardListRes.data) {
  if (!dashboardMeta.uid.startsWith(UID_PREFIX_WHITELIST)) {
    continue;
  }

  // Note, currently Grafana API does NOT support returning a dashboard with the
  // "Export for sharing externally" toggle turned on.
  // https://community.grafana.com/t/export-dashboard-for-external-use-via-http-api/50716

  /** @type {{data: DashboardGet}} */
  const dashboardDataRes = await axios.get(`${GRAFANA_URL}/api/dashboards/uid/${dashboardMeta.uid}`, {
    headers: {Authorization: `Bearer ${GRAFANA_API_KEY}`},
  });

  const outpath = path.join(OUTDIR, `${dashboardMeta.uid}.json`);

  // Only update dashboards that exist locally. Sometimes developers duplicate dashboards on the Grafana server
  // to test some new panels, with names like $uid_2.json. This script ignores those duplicates.
  // >> To add a new dashboard touch a file with filename `$uid.json`
  if (fs.existsSync(outpath)) {
    const prevDashboard = readGrafanaDashboard(outpath);

    // Lint dashboard to match target format
    const newDashboard = lintGrafanaDashboard(dashboardDataRes.data.dashboard);

    // Set version to same to reduce diff
    newDashboard.version = prevDashboard.version;

    // Save dashboard data to a JSON file
    writeGrafanaDashboard(outpath, newDashboard);
    console.log(`saved ${outpath}`);
  }
}

// {
//   id: 39,
//   uid: '1iQudJZVk',
//   title: 'Alerts',
//   uri: 'db/alerts',
//   url: '/dashboards/f/1iQudJZVk/alerts',
//   slug: '',
//   type: 'dash-folder',
//   tags: [],
//   isStarred: false,
//   sortMeta: 0
// },
/**
 * @typedef {Object} DashboardMeta
 * @property {number} id
 * @property {string} uid
 * @property {string} title
 * @property {string} uri
 * @property {string} url
 * @property {string} slug
 * @property {string} type
 * @property {string[]} tags
 * @property {boolean} isStarred
 * @property {number} sortMeta
 */

/**
 * @typedef {Object} DashboardGet
 * @property {import('./lint-grafana-dashboard.mjs').Dashboard} dashboard
 */
