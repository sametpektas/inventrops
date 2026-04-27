export interface ForecastInputPoint {
  date: Date;
  value: number;
}

export interface ForecastOutput {
  pred_30d: number | null;
  pred_90d: number | null;
  pred_180d: number | null;
  pred_365d: number | null;
  days_to_warning: number | null;
  days_to_critical: number | null;
  confidence_score: number | null;
  risk_level: 'green' | 'yellow' | 'orange' | 'red';
}

export function calculateForecast(
  history: ForecastInputPoint[],
  warningThreshold: number,
  criticalThreshold: number,
  direction: 'up' | 'down' = 'up'
): ForecastOutput {
  if (history.length === 0) {
    return {
      pred_30d: null, pred_90d: null, pred_180d: null, pred_365d: null,
      days_to_warning: null, days_to_critical: null,
      confidence_score: 0, risk_level: 'green'
    };
  }

  // With 1-2 points, use current value as flat projection (no trend)
  if (history.length < 3) {
    const currentVal = history[history.length - 1].value;
    let risk_level: 'green' | 'yellow' | 'orange' | 'red' = 'green';
    let days_to_warning: number | null = null;
    let days_to_critical: number | null = null;

    // For percentage metrics, check current value against thresholds
    if (direction === 'up') {
      if (currentVal >= criticalThreshold) { risk_level = 'red'; days_to_critical = 0; days_to_warning = 0; }
      else if (currentVal >= warningThreshold) { risk_level = 'orange'; days_to_warning = 0; }
    }

    return {
      pred_30d: currentVal, pred_90d: currentVal, pred_180d: currentVal, pred_365d: currentVal,
      days_to_warning, days_to_critical,
      confidence_score: 0.1, risk_level
    };
  }

  // Sort history chronologically
  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Convert to (x, y) arrays where x is days since first point
  const t0 = sorted[0].date.getTime();
  const x = sorted.map(p => (p.date.getTime() - t0) / (1000 * 60 * 60 * 24));
  const y = sorted.map(p => p.value);

  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumXX += x[i] * x[i];
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared for confidence
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = slope * x[i] + intercept;
    ssTot += Math.pow(y[i] - yMean, 2);
    ssRes += Math.pow(y[i] - yPred, 2);
  }
  const rSquared = ssTot === 0 ? 1 : Math.max(0, 1 - (ssRes / ssTot));

  // Current time in days since t0
  const currentX = (new Date().getTime() - t0) / (1000 * 60 * 60 * 24);

  const pred_30d = slope * (currentX + 30) + intercept;
  const pred_90d = slope * (currentX + 90) + intercept;
  const pred_180d = slope * (currentX + 180) + intercept;
  const pred_365d = slope * (currentX + 365) + intercept;

  let days_to_warning = null;
  let days_to_critical = null;

  if (slope > 0 && direction === 'up') {
    if (warningThreshold > intercept + slope * currentX) {
      days_to_warning = Math.max(0, Math.floor(((warningThreshold - intercept) / slope) - currentX));
    } else {
      days_to_warning = 0;
    }
    if (criticalThreshold > intercept + slope * currentX) {
      days_to_critical = Math.max(0, Math.floor(((criticalThreshold - intercept) / slope) - currentX));
    } else {
      days_to_critical = 0;
    }
  } else if (slope < 0 && direction === 'down') {
    if (warningThreshold < intercept + slope * currentX) {
      days_to_warning = Math.max(0, Math.floor(((warningThreshold - intercept) / slope) - currentX));
    } else {
      days_to_warning = 0;
    }
    if (criticalThreshold < intercept + slope * currentX) {
      days_to_critical = Math.max(0, Math.floor(((criticalThreshold - intercept) / slope) - currentX));
    } else {
      days_to_critical = 0;
    }
  }

  let risk_level: 'green' | 'yellow' | 'orange' | 'red' = 'green';
  if (days_to_critical !== null && days_to_critical <= 30) risk_level = 'red';
  else if (days_to_warning !== null && days_to_warning <= 30) risk_level = 'orange';
  else if (days_to_critical !== null && days_to_critical <= 90) risk_level = 'yellow';

  return {
    pred_30d,
    pred_90d,
    pred_180d,
    pred_365d,
    days_to_warning,
    days_to_critical,
    confidence_score: rSquared,
    risk_level
  };
}
