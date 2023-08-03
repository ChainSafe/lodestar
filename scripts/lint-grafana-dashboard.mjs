#!/usr/bin/env node

import fs from "node:fs";

// Logic for linting
//
// >> FOR SCRIPT USE `scripts/lint-grafana-dashboards.mjs`

/* eslint-disable
@typescript-eslint/no-unsafe-assignment,
@typescript-eslint/explicit-function-return-type,
@typescript-eslint/naming-convention,
quotes,
no-console
*/

/**
 * @typedef {Object} Dashboard
 * @property {any} [__elements]
 * @property {Input[]} [__inputs]
 * @property {any} [__requires]
 * @property {number} [graphTooltip]
 * @property {null} [id]
 * @property {Panel[]} [panels]
 * @property {string[]} [tags]
 * @property {Link[]} [links]
 * @property {Time} [time]
 * @property {Timepicker} [timepicker]
 * @property {string} [timezone]
 * @property {string} [weekStart]
 * @property {string} [refresh]
 * @property {Templating} [templating]
 * @property {number} version
 *
 * @typedef {Object} Input
 * @property {string} description - The description of the input.
 * @property {string} label - The label of the input.
 * @property {string} name - The name of the input.
 * @property {string} [pluginId] - The plugin id of the input, if applicable.
 * @property {string} [pluginName] - The plugin name of the input, if applicable.
 * @property {string} type - The type of the input.
 * @property {string} [value] - The value of the input, if applicable.
 *
 * @typedef {Object} Panel
 * @property {boolean} [collapsed]
 * @property {string} title
 * @property {Datasource} [datasource]
 * @property {FieldConfig} [fieldConfig]
 * @property {Target[]} [targets]
 * @property {Panel[]} [panels]
 *
 * @typedef {Object} FieldConfig
 * @property {FieldConfigDefaults} [defaults]
 *
 * @typedef {Object} FieldConfigDefaults
 * @property {any} [thresholds]
 *
 * @typedef {Object} Target
 * @property {Datasource} [datasource]
 * @property {boolean} [exemplar]
 * @property {string} [expr]
 *
 * @typedef {Object} Datasource
 * @property {string} type
 * @property {string} uid
 *
 * @typedef {Object} Link
 * @property {string} title
 *
 * @typedef {Object} Time
 * @property {string} from
 * @property {string} to
 *
 * @typedef {Object} Timepicker
 * @property {string[]} refresh_intervals
 *
 * @typedef {Object} Templating
 * @property {TemplatingListItem[]} [list]
 *
 * @typedef {Object} TemplatingListItem
 * @property {string} name
 * @property {string} query
 */

const variableNameDatasource = "DS_PROMETHEUS";
const variableNameRateInterval = "rate_interval";
const variableNameFilters = "Filters";

/**
 * @param {Dashboard} json
 * @returns {Dashboard}
 */
export function lintGrafanaDashboard(json) {
  // Drop properties added by "Export for sharing externally" to keep diff consistent
  delete json.__elements;
  delete json.__requires;

  // Always add Prometheus to __inputs
  const inputs = [
    {
      description: "",
      label: "Prometheus",
      name: variableNameDatasource,
      pluginId: "prometheus",
      pluginName: "Prometheus",
      type: "datasource",
    },
  ];

  // Add job names to __inputs if used by dashboard
  if (json.templating && json.templating.list) {
    for (const item of json.templating.list) {
      if (item.query === "${VAR_BEACON_JOB}") {
        inputs.push({
          description: "",
          label: "Beacon node job name",
          name: "VAR_BEACON_JOB",
          type: "constant",
          value: "beacon",
        });
      } else if (item.query === "${VAR_VALIDATOR_JOB}") {
        inputs.push({
          description: "",
          label: "Validator client job name",
          name: "VAR_VALIDATOR_JOB",
          type: "constant",
          value: "validator",
        });
      }
    }
  }

  // Ensure __inputs is first property to reduce diff
  json = {
    __inputs: inputs,
    ...json,
  };

  // Set to "Shared crosshair" option
  json.graphTooltip = 1;

  // null id to match "Export for sharing externally" format, only set to null if set to respect order
  if (json.id !== undefined) {
    json.id = null;
  }

  if (json.panels) {
    assertPanels(json.panels);
  }

  const LODESTAR_TAG = "lodestar";

  // Force add lodestar tag for easy navigation
  if (!json.tags) json.tags = [];
  if (!json.tags.includes(LODESTAR_TAG)) json.tags.push(LODESTAR_TAG);

  // Add links section
  const LINK_TITLE = "Lodestar dashboards";

  if (!json.links) json.links = [];
  if (!json.links.some((link) => link.title === LINK_TITLE)) {
    json.links.push({
      asDropdown: true,
      icon: "external link",
      includeVars: true,
      keepTime: true,
      tags: [LODESTAR_TAG],
      targetBlank: false,
      title: LINK_TITLE,
      tooltip: "",
      type: "dashboards",
      url: "",
    });
  }

  // Force time on a constant time window
  json.refresh = "10s";
  json.time = {
    from: "now-24h",
    to: "now",
  };

  // Force timezone and time settings
  json.timezone = "utc";
  json.weekStart = "monday";
  if (!json.timepicker) json.timepicker = {};
  json.timepicker.refresh_intervals = ["5s", "10s", "30s", "1m", "5m", "15m", "30m", "1h", "2h", "1d"];

  // Add common variables
  if (!json.templating) json.templating = {};
  if (!json.templating.list) json.templating.list = [];

  assertTemplatingListItemContent(json, variableNameDatasource, {
    current: {selected: false, text: "default", value: "default"},
    hide: 0,
    includeAll: false,
    label: "datasource",
    multi: false,
    name: variableNameDatasource,
    options: [],
    query: "prometheus",
    queryValue: "",
    refresh: 1,
    regex: "",
    skipUrlSync: false,
    type: "datasource",
  });

  assertTemplatingListItemContent(json, variableNameRateInterval, {
    auto: true,
    auto_count: 30,
    auto_min: "10s",
    current: {selected: false, text: "1h", value: "1h"},
    hide: 0,
    label: "rate() interval",
    name: variableNameRateInterval,
    options: [
      {selected: false, text: "auto", value: "$__auto_interval_rate_interval"},
      {selected: false, text: "1m", value: "1m"},
      {selected: false, text: "10m", value: "10m"},
      {selected: false, text: "30m", value: "30m"},
      {selected: true, text: "1h", value: "1h"},
      {selected: false, text: "6h", value: "6h"},
      {selected: false, text: "12h", value: "12h"},
      {selected: false, text: "1d", value: "1d"},
      {selected: false, text: "7d", value: "7d"},
      {selected: false, text: "14d", value: "14d"},
      {selected: false, text: "30d", value: "30d"},
    ],
    query: "1m,10m,30m,1h,6h,12h,1d,7d,14d,30d",
    queryValue: "",
    refresh: 2,
    skipUrlSync: false,
    type: "interval",
  });

  assertTemplatingListItemContent(json, variableNameFilters, {
    datasource: {
      type: "prometheus",
      uid: "prometheus_local",
    },
    filters: [
      {
        condition: "",
        key: "instance",
        operator: "=",
        value: "unstable-lg1k-hzax41",
      },
    ],
    hide: 0,
    name: "Filters",
    skipUrlSync: false,
    type: "adhoc",
  });

  return json;
}

/**
 * @param {string} filepath
 * @returns {Dashboard}
 */
export function readGrafanaDashboard(filepath) {
  const jsonStr = fs.readFileSync(filepath, "utf8");
  /** @type {Dashboard} */
  const json = JSON.parse(jsonStr);
  return json;
}

/**
 * @param {string} filepath
 * @param {Dashboard} json
 */
export function writeGrafanaDashboard(filepath, json) {
  // Add new line
  const jsonStrOut = JSON.stringify(json, null, 2) + "\n";
  fs.writeFileSync(filepath, jsonStrOut);
}

/**
 * @param {Dashboard} json
 * @param {string} varName
 * @param {TemplatingListItem} item
 */
function assertTemplatingListItemContent(json, varName, item) {
  if (!json.templating) json.templating = {};
  if (!json.templating.list) json.templating.list = [];

  const index = json.templating.list.findIndex((item) => item.name === varName);

  if (index < 0) {
    // No match, push new item
    json.templating.list.push(item);
  } else {
    // Match replace content
    json.templating.list[index] = item;
  }
}

/**
 * @param {Panel[]} panels
 */
function assertPanels(panels) {
  for (const panel of panels) {
    if (panel.collapsed === true) {
      throw Error(`all panels must be expanded, go to the UI and expand panel with title ${panel.title}`);
    }

    // Panel datasource must point to the datasource variable
    if (panel.datasource) {
      panel.datasource.type = "prometheus";
      panel.datasource.uid = `\${${variableNameDatasource}}`;
    }

    if (panel.targets) {
      for (const target of panel.targets) {
        // All panels must point to the datasource variable
        if (target.datasource) {
          target.datasource.type = "prometheus";
          target.datasource.uid = `\${${variableNameDatasource}}`;
        }

        // Disable exemplar
        if (target.exemplar !== undefined) {
          target.exemplar = false;
        }

        if (target.expr) {
          // Force usage of interval variable
          target.expr = target.expr.replace(/\$__rate_interval/g, `$${variableNameRateInterval}`);

          // Ensure to always use variables to match job names
          target.expr = target.expr.replace(/job="beacon"/g, 'job=~"$beacon_job|beacon"');
          target.expr = target.expr.replace(/job="validator"/g, 'job=~"$validator_job|validator"');

          // Ban use of delta and increase functions.
          // Mixed use of delta / increase and rate make dashboards more difficult to reason about.
          // - delta shows the value difference based on the selected time interval, which is variable
          //   so if time interval is X or 2*X the displayed values double.
          // - rate shows the per-second average rate regardless of time interval. The time interval just
          //   controls how "smooth" that average is.
          // Using rate results in an easier read of values. Sometimes the rate will be scaled up to
          // rate / slot, rate / epoch, or rate / min; all of which are clearly indicated in the chart title
          if (target.expr.includes("delta(")) {
            throw Error(`promql function 'delta' is not allowed, use 'rate' instead: ${target.expr}`);
          }
          if (target.expr.includes("increase(")) {
            throw Error(`promql function 'increase' is not allowed, use 'rate' instead: ${target.expr}`);
          }
        }
      }
    }

    // Drop threshold defaults at `fieldConfig.defaults.thresholds`
    // They are a source of diffs constant since consencutive exports assign null values
    // while other don't. Since we do not plan to add default thresholds, drop for now
    if (panel.fieldConfig?.defaults?.thresholds) {
      delete panel.fieldConfig?.defaults?.thresholds;
    }

    // Recursively check nested panels
    if (panel.panels) {
      assertPanels(panel.panels);
    }
  }
}
