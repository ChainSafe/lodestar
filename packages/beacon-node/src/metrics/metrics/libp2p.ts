import {Libp2p} from "libp2p";
import {GaugeExtra} from "../utils/gauge.js";
import {RegistryMetricCreator} from "../utils/registryMetricCreator.js";

export type ILibp2pMetrics = ReturnType<typeof createLibp2pMetrics>;

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createLibp2pMetrics(libp2p: Libp2p, register: RegistryMetricCreator) {
  const libp2pMetrics = libp2p.metrics;
  if (libp2pMetrics === undefined) {
    return;
  }

  const metrics: Record<string, GaugeExtra<string>> = {};

  const ensureLibp2pMetrics = async (): Promise<void> => {
    // protocol metrics
    const protocols = libp2pMetrics.getProtocols();
    protocols.forEach((protocol) => {
      const protocolStat = libp2pMetrics.forProtocol(protocol);
      if (protocolStat === undefined) {
        return;
      }

      // create metric if undefined
      if (metrics[protocol] === undefined) {
        const name = `libp2p_protocol_${protocol}_bytes`.replace(/(\/|-|\.)/g, "_");
        metrics[protocol] = register.gauge<"direction">({
          name,
          help: name,
          labelNames: ["direction"],
        });
      }

      // set metric
      const protocolSnapshot = protocolStat.getSnapshot();
      metrics[protocol].set({direction: "received"}, Number(protocolSnapshot.dataReceived));
      metrics[protocol].set({direction: "sent"}, Number(protocolSnapshot.dataSent));
    });

    // component metrics
    for (const [systemName, systemMetrics] of libp2pMetrics.getComponentMetrics().entries()) {
      for (const [componentName, componentMetrics] of systemMetrics.entries()) {
        for (const [metricName, trackedMetric] of componentMetrics.entries()) {
          // In practice `systemName` is always libp2p
          const name = `${systemName}_${componentName}_${metricName}`.replace(/-/g, "_");

          // create metric if undefined
          if (metrics[name] === undefined) {
            metrics[name] = register.gauge({
              name,
              help: trackedMetric.help ?? name,
              labelNames: trackedMetric.label !== undefined ? [trackedMetric.label] : [],
            });
          }

          // set metric
          const m = await trackedMetric.calculate();
          if (typeof m === "number") {
            metrics[name].set(m);
          } else {
            const labelName = trackedMetric.label ?? name;
            Object.entries(m).forEach(([label, value]) => {
              metrics[name].set({[labelName]: label}, value);
            });
          }
        }
      }
    }
  };

  metrics.global = register.gauge<"direction">({
    name: "libp2p_global_stats",
    help: "libp2p global stats",
    labelNames: ["direction"],
    collect: async () => {
      const globalSnapshot = libp2pMetrics.getGlobal().getSnapshot();
      metrics.global.set({direction: "received"}, Number(globalSnapshot.dataReceived));
      metrics.global.set({direction: "sent"}, Number(globalSnapshot.dataSent));

      await ensureLibp2pMetrics();
    },
  });
}
