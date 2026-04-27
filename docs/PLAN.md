# InvenTrOps Enhancements Plan

## Task Overview
1. **Remove Admin Panel Button**: Remove the Admin Panel button from the frontend Layout component.
2. **Merge "Unknown No OS" with "Bare Metal"**: Update the Dashboard/Analytics OS chart grouping to combine physical servers and those with unknown OS under "Bare Metal". Fix related filter logic so clicking on it shows both properly.
3. **Update Expiry Dashboard Metrics**: Update the warranty stat cards to display 3 categories:
   - Expire olanlar (Expired)
   - Yıl içerisinde expire olacaklar (Expiring this year / Next 365 days)
   - Bir sonraki yıl expire olacaklar (Expiring next year / 366-730 days)
4. **Make Vendor Summary Clickable**: In the Dashboard Vendor Summary list, add click events to each vendor row that navigates to the Inventory page with the selected vendor filter.
5. **Add Active Inventory Filters**: Add new dropdown filters to the Inventory page (next to search):
   - Vendor (Marka)
   - Model
   - Location (Datacenter/Room)
   - Device Type (with explicit options for Storage, Server, SAN, etc.)

## Execution Steps
1. **Frontend Layout**: Modify `frontend/src/components/Layout.jsx` to remove the Admin Panel link.
2. **Backend Analytics**: Update `backend/src/controllers/inventory.controller.ts` `getAnalytics` to:
   - Change the `virtualization_distribution` to return only "Virtualization" and "Bare Metal" (combining physical and unknown).
   - Change the `periods` logic for warranty charts from 180/360/720 to Expired, 0-365 days (This Year), and 366-730 days (Next Year).
3. **Frontend Dashboard/Analytics**: 
   - Update `Analytics.jsx` and `Dashboard.jsx` stat-grids to reflect the 3 new warranty categories instead of the 4 hardcoded ones.
   - Add `cursor: pointer` and `onClick` navigation to the Vendor Summary list in `Dashboard.jsx`.
4. **Frontend Inventory Filters**: Modify `Inventory.jsx` to include `<select>` inputs in the toolbar for Vendor, Model, Location, and Device Type. Ensure these state changes trigger `setSearchParams` and update the URL/query.

## Next Steps
Do you approve of this plan? Please reply with "Y" to proceed with implementation or "N" if you want adjustments.
