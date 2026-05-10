# InvenTrOps - PowerPoint Report Generation Plan

## 1. Problem Statement
The user wants to generate a comprehensive PowerPoint (PPTX) presentation containing 6-month performance and capacity charts for selected storage devices (data originating from Xormon). The presentation must separate data by location (Ankara as Prod, Istanbul as DR).

## 2. Requirements
1. **Slide 1 (General Overview):** Overall capacity usage chart for ALL Xormon storages, separated by location (Ankara vs. Istanbul).
2. **Slide 2 (Selected Devices - Capacity):** 6-month capacity trend chart for the user-selected devices, grouped by location.
3. **Slide 3 (Selected Devices - IOPS):** 6-month IOPS trend chart for the selected devices, grouped by location.
4. **Slide 4 (Selected Devices - Response Time):** 6-month Response Time trend chart for the selected devices, grouped by location.

## 3. Implementation Steps

We will orchestrate 3 agents to design, implement, and verify this feature:

1. **`backend-specialist` (API & Logic)**:
   - Install `pptxgenjs` library in the backend to construct PowerPoint files with charts.
   - Create a new API endpoint (e.g., `POST /api/reports/generate-pptx`) that accepts an array of device serial numbers.
   - The endpoint will query `ForecastMetricSnapshot` for the available metrics ('capacity', 'iops', and 'response_time') up to the last 6 months. If less than 6 months of data is available, it will use all available data.
   - It will join `InventoryItem` data to determine the location (Ankara/Istanbul) and aggregate the data.
   - Generate the PPTX Buffer and return it as a downloadable file stream.

2. **`frontend-specialist` (UI Integration)**:
   - Create a new sub-menu item called "Bülten" (Bulletin) in the frontend navigation.
   - Design a dedicated report generation page under the "Bülten" menu where users can select specific storage devices.
   - Add a "Bülten Oluştur" (Generate Bulletin) button that posts the selected serial numbers to the backend endpoint and downloads the `.pptx` file.

3. **`test-engineer` / `security-auditor` (Verification)**:
   - Verify that the API properly validates the incoming device array and handles missing data gracefully.
   - Ensure the PPTX generation does not block the Node.js event loop excessively.
   - Run `security_scan.py` and `lint_runner.py` to ensure code quality and safety.

## 4. Acceptance Criteria
- User can navigate to a dedicated "Bülten" submenu to select devices and download a PowerPoint presentation.
- The presentation contains the 4 requested slide types.
- Charts accurately reflect historical data up to 6 months (or less if 6 months are not available), separated by Ankara (Prod) and Istanbul (DR).
- CI/CD scripts run without introducing new errors.
