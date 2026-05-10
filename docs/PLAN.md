# InvenTrOps - AI Pagination Bug Fix Plan

## 1. Problem Statement
The user reported that when querying the AI assistant for the count of HPE (and Dell) servers, the assistant consistently reports exactly 50 servers, despite there being 113 servers in the actual inventory database.

## 2. Root Cause Analysis
During the initial discovery phase (using `explorer-agent`), the AI service logic (`backend/src/services/ai.service.ts`) was examined. 
In the `search_inventory` tool execution block, there is a hardcoded Prisma limit (`take: 50`):

```typescript
    case 'search_inventory':
      return await prisma.inventoryItem.findMany({
          // ... filters ...
        include: { model: { include: { vendor: true } } },
        take: 50 // Daha fazla sonuç alabilmesi için sınırı artırdık
      });
```
Because of this `take: 50` limit, any search returning more than 50 elements is truncated, which causes the AI to incorrectly count the total items as 50.

## 3. Implementation Steps

We will orchestrate 3 agents to fix and verify the issue:

1. **`backend-specialist` (Core Implementation)**:
   - Modify the `search_inventory` case in `backend/src/services/ai.service.ts`.
   - Remove or significantly increase the `take` limit (e.g., to 1000) or implement dynamic pagination based on the LLM's arguments. 
   - Note: Since LLM context limits exist, returning all fields for 1000 items might cause token overflow. The optimal solution is to return only essential fields for counting/listing or implement a specialized tool for aggregations like `count_inventory`.

2. **`test-engineer` (Verification)**:
   - Ensure the updated search logic doesn't cause out-of-memory errors.
   - Run verification scripts (`lint_runner.py`).

3. **`security-auditor` (Security Check)**:
   - Run `security_scan.py` to ensure expanding query results doesn't introduce vulnerabilities or massive payload risks.

## 4. Acceptance Criteria
- AI Assistant accurately reports the total number of HPE/Dell servers.
- The `search_inventory` tool can process queries for more than 50 items.
- CI/CD checks pass (Linting & Security).
