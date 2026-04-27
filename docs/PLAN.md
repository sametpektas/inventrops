# Phase 2: Capacity Forecasting & Performance Planning

## Task Overview
Add a new Capacity Forecasting module to the existing InvenTrOps application without altering the current stack (Node.js, Prisma, PostgreSQL, BullMQ, React). The goal is to collect historical metrics from Xormon and vROps, calculate future capacity needs using linear regression and moving averages, and alert users of impending capacity or performance bottlenecks.

## 1. Database Layer (Prisma)
Add the following models to `schema.prisma`:
- `ForecastSource`: Tracks connection details/integration link to Xormon/vROps.
- `ForecastMetricSnapshot`: Stores point-in-time metrics for each device/object.
- `ForecastResult`: Stores the calculated predictions (30d, 90d, 180d, 365d), days to thresholds, and confidence score.
- `ForecastJob`: Logs the BullMQ background tasks.
- `ForecastAlert`: Stores generated alerts based on threshold violations (Warning, Critical).

## 2. Provider Architecture
Create two new data collectors in `backend/src/services/forecast/providers/`:
- `xormonForecast.provider.ts`: Authenticates securely, fetches Storage (capacity, iops, latency, throughput) and SAN (port utilization, errors) metrics.
- `vropsForecast.provider.ts`: Fetches Server & Virtualization (CPU, memory, disk, cluster demand, VM count) metrics.
Both providers will normalize the data into a common `NormalizedMetric` format and safely handle API errors/timeouts without logging secrets.

## 3. Forecast Engine
Create `backend/src/services/forecast/engine.ts`:
- **Algorithms**: Implement Linear Regression and Moving Average.
- **Outlier Filtering**: Use standard deviation/Z-score to exclude anomalies.
- **Calculations**: Predict values at 30, 90, 180, and 365 days. Calculate `days_to_warning`, `days_to_critical`, `confidence_score`, and `risk_level` (green, yellow, orange, red).

## 4. Background Jobs (BullMQ)
Add queues and workers in `backend/src/workers/`:
- **Metric Collection Job**: Periodically syncs metrics from providers.
- **Forecast Calculation Job**: Runs the engine over the latest snapshot window.
- **Alert Generation Job**: Triggers thresholds and creates `ForecastAlert` records.

## 5. API Endpoints
Create `backend/src/routes/forecast.routes.ts` and `forecast.controller.ts`:
- `GET /api/forecast/summary`
- `GET /api/forecast/storage`
- `GET /api/forecast/san`
- `GET /api/forecast/server`
- `GET /api/forecast/virtualization`
- `GET /api/forecast/:objectId/history`
- `POST /api/forecast/sync`
- `POST /api/forecast/recalculate`
*Note: All endpoints will enforce existing RBAC and team-level scoping.*

## 6. Frontend Integration
Create a new `Forecast` section in `frontend/src/pages/forecast/`:
- `ForecastDashboard.jsx`: Overview of critical risks and summary charts.
- Detail Pages: `StorageForecast.jsx`, `SanForecast.jsx`, `ServerForecast.jsx`, `VirtForecast.jsx`.
- Tables will display: Object Name, Type, Current Value, 30/90/180/365d Predictions, Days to Warning/Critical, Confidence, Risk Level, and Last Updated.

## 7. Security & DevOps
- Use existing RBAC middlewares.
- Validate external metrics using Zod or similar.
- Do not expose or log provider credentials.
- Preserve existing Docker/docker-compose startup sequences. (No new heavy services added).

## 8. Testing
- Unit tests for engine calculations (Linear Regression, Moving Average).
- Unit tests for Provider normalization and API failure handling.
- Tests for RBAC filtering on new endpoints.

## ⏸️ CHECKPOINT
Do you approve of this plan? Please reply with "Y" to start implementation, or "N" to modify the plan.
