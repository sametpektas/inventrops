# Phase 2.1: Forecast Integrations Configuration UI

## Task Overview
The user needs a way to configure vROps and Xormon data sources (URL, API Key, credentials) directly from the UI, so the `ForecastSource` database table is populated and the backend workers can start collecting metrics.

## 1. Backend Changes
- **Endpoints**: Add CRUD endpoints for `ForecastSource` in `backend/src/controllers/forecast.controller.ts`.
  - `GET /api/forecast/config`: List configured sources.
  - `POST /api/forecast/config`: Add or update a source.
  - `DELETE /api/forecast/config/:id`: Delete a source.
- **Routes**: Register these in `backend/src/routes/forecast.routes.ts`.

## 2. Frontend Changes
- **Component**: Create a new UI modal or settings page in `frontend/src/pages/forecast/ForecastSettings.jsx`.
- **Integration**: Add a "Settings / Integrations" button on the `ForecastDashboard.jsx` header to open this modal/page.
- **Form Fields**:
  - Source Name (e.g., "vROps Primary")
  - Source Type (Dropdown: vROps, Xormon)
  - URL (e.g., https://vrops.local)
  - API Key (Password field for security)
  - Username / Password (Optional, depending on Xormon/vROps requirements)

## 3. Security
- Only `admin` role can view and edit these credentials.
- API Keys are not returned back to the frontend in plain text on `GET` requests (return dummy masked string `********`).

## ⏸️ CHECKPOINT
Do you approve of this plan to build the configuration screen? Please reply with "Y" to start implementation, or "N" to modify the plan.
