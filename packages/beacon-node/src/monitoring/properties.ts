import {Registry} from "prom-client";
import {JsonRecord, JsonType, MetricObject, MetricValue, MetricWithGetter, RecordValue} from "./types.js";

interface PropertyDefinition {
  /** Key of value to be sent to remote server */
  jsonKey: string;
}

interface StaticPropertyDefinition<T extends RecordValue> extends PropertyDefinition {
  /** Static value */
  value: T;
}

interface DynamicPropertyDefinition<T extends RecordValue> extends PropertyDefinition {
  /** Value provider function */
  provider: () => T | Promise<T>;
  /** Only call provider once and then use cached value */
  cacheResult?: boolean;
}

interface MetricPropertyDefinition<T extends RecordValue> extends PropertyDefinition {
  /** Type of value to be sent to remote server */
  jsonType: JsonType;
  /** Name of the metric */
  metricName: string;
  /** Get value from metric with label */
  withLabel?: {name: string; value: string};
  /** Get value from label instead of metric value */
  fromLabel?: string;
  /** Range value to evaluate to true */
  rangeValue?: number;
  /** Function to format retrieved metric value */
  formatter?: (value: MetricValue) => MetricValue;
  /** Only fetch metric once and then use cached value */
  cacheResult?: boolean;
  /** Default value if metric does not exist */
  defaultValue: T;
}

export interface ClientStatsProperty<T extends RecordValue> {
  getRecord(register: Registry): JsonRecord<T> | Promise<JsonRecord<T>>;
}

export class StaticProperty<T extends RecordValue> implements ClientStatsProperty<T> {
  constructor(private readonly definition: StaticPropertyDefinition<T>) {}

  getRecord(): JsonRecord<T> {
    return {key: this.definition.jsonKey, value: this.definition.value};
  }
}

export class DynamicProperty<T extends RecordValue> implements ClientStatsProperty<T> {
  private cachedValue?: T;

  constructor(private readonly definition: DynamicPropertyDefinition<T>) {}

  async getRecord(): Promise<JsonRecord<T>> {
    if (this.cachedValue != null) {
      return {key: this.definition.jsonKey, value: this.cachedValue};
    }

    const value = await this.definition.provider();

    if (this.definition.cacheResult) {
      this.cachedValue = value;
    }

    return {key: this.definition.jsonKey, value};
  }
}

export class MetricProperty<T extends RecordValue> implements ClientStatsProperty<T> {
  private cachedValue?: T;

  constructor(private readonly definition: MetricPropertyDefinition<T>) {}

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
          return this.definition.rangeValue != null ? value === this.definition.rangeValue : value > 0;
      }
    }
    return value;
  }
}
