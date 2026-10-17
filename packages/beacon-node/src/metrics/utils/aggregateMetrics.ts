import {AggregatorRegistry, MetricObjectWithValues, MetricValue} from "prom-client";

/** Plain prom-client data and exposition text from nested workers or native collectors. */
export type ScrapedMetrics = {
  metrics: MetricObjectWithValues<MetricValue<string>>[];
  extra: string;
};

/** Registries are ordered by precedence for families using the "first" aggregator. */
export async function aggregateMetrics(registries: ScrapedMetrics["metrics"][]): Promise<string> {
  const counts = new Map<string, number>();
  for (const metrics of registries) {
    for (const metric of metrics) counts.set(metric.name, (counts.get(metric.name) ?? 0) + 1);
  }

  return AggregatorRegistry.aggregate(
    registries.map((metrics) =>
      metrics.map((metric) =>
        // Preserve singleton families, including process_start_time_seconds (cluster aggregator: omit).
        // Builder clients use collect precedence for URL scores instead of summing them.
        counts.get(metric.name) === 1 || metric.name === "lodestar_builder_http_client_urls_score"
          ? {...metric, aggregator: "first"}
          : metric
      )
    )
  ).metrics();
}
