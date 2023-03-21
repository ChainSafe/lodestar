import {Registry} from "prom-client";
import {JsonRecord, JsonType, MetricObject, MetricValue, MetricWithGetter, RecordValue} from "./types.js";

type PropertyDefinition = {
  /** Key of value to be sent to remote service */
  jsonKey: string;
  /** Description of the property */
  description?: string;
};

type StaticPropertyDefinition<T extends RecordValue> = PropertyDefinition & {
  /** Static value */
  value: T;
};

type DynamicPropertyDefinition<T extends RecordValue> = PropertyDefinition & {
  /** Value provider function */
  provider: () => T;
};

type MetricPropertyDefinition<T extends RecordValue> = PropertyDefinition & {
  /** Type of value to be sent to remote service */
  jsonType: JsonType;
  /** Name of the metric */
  metricName: string;
  /** Get value from metric with label */
  withLabel?: {name: string; value: string};
  /** Get value from label instead of metric value */
  fromLabel?: string;
  /** Range value to evaluate to true */
  rangeValue?: number;
  /** Evaluate to true if value is greater than or equal to threshold */
  threshold?: number;
  /** Function to format retrieved metric value */
  formatter?: (value: MetricValue) => MetricValue;
  /** Only fetch metric once and then use cached value */
  cacheResult?: boolean;
  /** Default value if metric does not exist */
  defaultValue: T;
};

/**
 * Interface to be implemented by client stats properties
 */
export interface ClientStatsProperty<T extends RecordValue> {
  readonly definition: PropertyDefinition;

  getRecord(register: Registry): JsonRecord<T> | Promise<JsonRecord<T>>;
}

/**
 * Static property that can be used to define hard-coded values
 */
export class StaticProperty<T extends RecordValue> implements ClientStatsProperty<T> {
  constructor(readonly definition: StaticPropertyDefinition<T>) {}

  getRecord(): JsonRecord<T> {
    return {key: this.definition.jsonKey, value: this.definition.value};
  }
}

/**
 * Dynamic property that can be used to get value from a provider function
 */
export class DynamicProperty<T extends RecordValue> implements ClientStatsProperty<T> {
  constructor(readonly definition: DynamicPropertyDefinition<T>) {}

  getRecord(): JsonRecord<T> {
    return {key: this.definition.jsonKey, value: this.definition.provider()};
  }
}

/**
 * Metric property that can be used to get value from an existing prometheus metric
 */
export class MetricProperty<T extends RecordValue> implements ClientStatsProperty<T> {
  private cachedValue?: T;

  constructor(readonly definition: MetricPropertyDefinition<T>) {}

  async getRecord(register: Registry): Promise<JsonRecord<T>> {
    if (this.cachedValue != null) {
      return {key: this.definition.jsonKey, value: this.cachedValue};
    }

    const metric = register.getSingleMetric(this.definition.metricName);

    if (metric) {
      const metricObject = await (metric as MetricWithGetter).get();

      const metricValue = this.extractMetricValue(metricObject);

      if (metricValue != null) {
        const formattedValue = this.formatMetricValue(metricValue);

        const typedValue = this.convertMetricValue(formattedValue) as T;

        if (this.definition.cacheResult) {
          this.cachedValue = typedValue;
        }

        return {key: this.definition.jsonKey, value: typedValue};
      }
    }

    return {key: this.definition.jsonKey, value: this.definition.defaultValue};
  }

  private extractMetricValue(metricObject: MetricObject): MetricValue | undefined {
    const {withLabel, fromLabel} = this.definition;

    if (withLabel) {
      // get value from metric with specific label, e.g. protocol="global received"
      return metricObject.values.find((v) => v.labels[withLabel.name] === withLabel.value)?.value;
    }

    if (fromLabel) {
      // get value from label, e.g. lodestar_version{version="v1.3.0/2d0938e"} => v1.3.0/2d0938e
      return metricObject.values[0].labels[fromLabel];
    }

    // metric value e.g. beacon_head_slot 5603174 => 5603174
    return metricObject.values[0].value;
  }

  private formatMetricValue(value: MetricValue): MetricValue {
    if (!this.definition.formatter) {
      return value;
    }
    return this.definition.formatter(value);
  }

  private convertMetricValue(value: MetricValue): RecordValue {
    if (typeof value === "number") {
      switch (this.definition.jsonType) {
        case JsonType.String:
          return value.toString();
        case JsonType.Number:
          return Math.round(value);
        case JsonType.Boolean:
          if (this.definition.rangeValue != null) {
            return value === this.definition.rangeValue;
          } else if (this.definition.threshold != null) {
            return value >= this.definition.threshold;
          } else {
            return value > 0;
          }
      }
    }
    return value;
  }
}
