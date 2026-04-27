export interface NormalizedMetric {
  objectId: string;
  objectName: string;
  objectType: string;
  metricName: string;
  metricValue: number;
  timestamp: Date;
}

export interface ForecastProvider {
  collectMetrics(sourceId: number): Promise<NormalizedMetric[]>;
}
