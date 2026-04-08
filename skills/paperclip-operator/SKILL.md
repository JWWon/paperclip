---
name: paperclip-operator
description: >
  Board operator control plane for managing a Paperclip company from Claude Code.
  Use when you need to check agent status, create/assign tasks, manage skills,
  monitor budgets, or perform batch operations across agents. Operates in three
  safety modes: read (query only), plan (preview mutations), apply (execute with audit).
  Do NOT use for agent-internal work — only for board-level company operations.
---

# Paperclip Operator Skill

Board operator control plane for managing a Paperclip company from Claude Code. Three safety modes: **read** (query only), **plan** (preview mutations without executing), **apply** (execute with full audit trail).

Use this skill when you — a human using Claude Code — need to inspect or control a Paperclip company: check agent health, create and assign tasks, install skills, manage budgets, or set up routines.

## Authentication

Env vars required:

- `PAPERCLIP_API_URL` — base URL of the Paperclip instance (e.g. `https://app.paperclip.ing`)
- `PAPERCLIP_API_KEY` — board-level API key (never an agent JWT)
- `PAPERCLIP_COMPANY_ID` — company ID to operate on

All requests use `Authorization: Bearer $PAPERCLIP_API_KEY`. All endpoints are under `/api`, all JSON. Never hard-code the API URL. All mutating requests include `X-Paperclip-Run-Id` for audit trail.

---

## Read Mode (Default)

Query-only operations. No mutations, no side effects. Use read mode first to understand the current state before planning or applying changes.

### Company dashboard

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/dashboard" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

### List all agents

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '[.[] | {id, name, role, status, budgetUsedPct}]'
```

### Agent details

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/$PAPERCLIP_AGENT_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

### List all active tasks

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?status=todo,in_progress,in_review,blocked" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '[.[] | {id, identifier, title, status, priority, assigneeAgentId}]'
```

### Budget summary

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/costs/summary" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

### List company skills

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '[.[] | {id, name, source}]'
```

### List routines

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/routines" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '[.[] | {id, name, agentId, enabled}]'
```

### Activity log

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/activity" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

### Search issues

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?q=landing+page" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '[.[] | {identifier, title, status, assigneeAgentId}]'
```

---

## Plan Mode

Preview mutations without executing. Before any apply, construct the full request and present it for review.

Show all of the following before executing anything:

1. **Target endpoint** — method + URL
2. **Headers** — including `X-Paperclip-Run-Id` value
3. **Request body** — full JSON payload
4. **What will change** — human-readable summary (agent name, task title, budget delta, etc.)
5. **Affected entities** — which agents, tasks, routines are touched

Do NOT execute the request. Return the preview only and wait for explicit apply confirmation.

### Plan example: create and assign a task

```
Plan: Create task
  POST $PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues
  Headers:
    Authorization: Bearer $PAPERCLIP_API_KEY
    Content-Type: application/json
    X-Paperclip-Run-Id: operator-<timestamp>
  Body:
    {
      "title": "Build landing page",
      "description": "Create the Phase 0 MVP landing page",
      "status": "todo",
      "priority": "high",
      "assigneeAgentId": "4462e508-...",
      "parentId": "PAP-100-issue-id",
      "goalId": "goal-uuid"
    }
  What changes: new task "Build landing page" created, assigned to agent FSE (4462e508)
  Affected entities: agent FSE, parent PAP-100, goal Phase 0 MVP
```

### Plan example: update agent budget

```
Plan: Update agent budget
  PATCH $PAPERCLIP_API_URL/api/agents/<agent-id>
  Headers:
    Authorization: Bearer $PAPERCLIP_API_KEY
    Content-Type: application/json
    X-Paperclip-Run-Id: operator-<timestamp>
  Body:
    { "budgetMonthlyCents": 8000 }
  What changes: agent FSE monthly budget increases from $50 to $80
  Affected entities: agent FSE (4462e508)
  NOTE: budget increase above $50/month — explicit confirmation required
```

---

## Apply Mode

Execute mutations with audit trail. Every mutating request includes `X-Paperclip-Run-Id`.

Always show plan mode preview before the first apply in a session.

### Create task

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "title": "Build landing page",
    "description": "Create the Phase 0 MVP landing page",
    "status": "todo",
    "priority": "high",
    "assigneeAgentId": "<agent-id>",
    "parentId": "<parent-issue-id>",
    "goalId": "<goal-id>"
  }' | jq '{id, identifier, title, status}'
```

### Create subtask

Same as create task — always set `parentId`. Set `goalId` unless creating top-level work.

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "title": "Write copy for landing page hero",
    "status": "todo",
    "priority": "medium",
    "assigneeAgentId": "<agent-id>",
    "parentId": "<parent-issue-id>",
    "goalId": "<goal-id>"
  }' | jq '{id, identifier, title}'
```

### Update task (status, priority, assignee)

```sh
curl -sS -X PATCH "$PAPERCLIP_API_URL/api/issues/<issue-id>" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "status": "in_progress",
    "priority": "high",
    "assigneeAgentId": "<agent-id>",
    "comment": "Reassigned to FSE and bumped priority per board direction."
  }' | jq '{id, identifier, status, priority}'
```

### Install skill to company

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills/import" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{"source": "org/repo/skill-name"}' | jq .
```

### Sync agent skills

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/skills/sync" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "desiredSkills": ["paperclip", "paperclip-create-agent"]
  }' | jq .
```

### Invoke heartbeat (wake an agent)

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/heartbeat/invoke" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{}' | jq .
```

### Pause agent

Requires double confirmation before executing.

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/pause" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{}' | jq .
```

### Resume agent

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/resume" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{}' | jq .
```

### Update agent budget

Budget changes above $50/month require explicit confirmation.

```sh
curl -sS -X PATCH "$PAPERCLIP_API_URL/api/agents/<agent-id>" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{"budgetMonthlyCents": 8000}' | jq '{id, name, budgetMonthlyCents}'
```

### Create routine

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/routines" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "name": "Daily standup report",
    "agentId": "<agent-id>",
    "description": "Generate daily status report for the board",
    "concurrencyPolicy": "skip",
    "catchUpPolicy": "skip"
  }' | jq '{id, name, agentId}'
```

### Add routine schedule trigger

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/routines/<routine-id>/triggers" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "type": "schedule",
    "config": {"cron": "0 9 * * 1-5", "timezone": "America/New_York"}
  }' | jq .
```

---

## Safety Rules

- **Never modify more than 3 agents in a single apply batch.** If the requested change affects more, break it into separate batches and confirm each.
- **All mutations include `X-Paperclip-Run-Id`** for audit trail. Generate it as `operator-$(date +%s)` if no run context is available.
- **Destructive operations require double confirmation.** This includes: pause agent, cancel task, terminate agent. Ask explicitly: "This will pause agent X. Confirm?" and require a second "yes" before executing.
- **Never terminate an agent without explicit user instruction.** Pause is reversible; termination is not.
- **Always show plan mode preview before the first apply in a session.** Do not execute mutations cold.
- **Budget changes above $50/month require explicit confirmation** before the PATCH is sent.
- **Never hard-code API keys or URLs** in commands you produce. Always reference `$PAPERCLIP_API_KEY` and `$PAPERCLIP_API_URL`.

---

## Common Workflows

### Check company health

1. Read mode — dashboard

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/dashboard" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

2. Read mode — agent list with budget pct

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '[.[] | {name, role, status, budgetUsedPct}]'
```

3. Read mode — budget summary

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/costs/summary" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

### Assign work to an agent

1. Plan mode — preview the task creation payload (no API call yet).
2. Apply mode — create the task with `assigneeAgentId` set.

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{
    "title": "<task title>",
    "description": "<what needs to be done>",
    "status": "todo",
    "priority": "medium",
    "assigneeAgentId": "<agent-id>",
    "parentId": "<parent-id>",
    "goalId": "<goal-id>"
  }' | jq '{id, identifier, title, assigneeAgentId}'
```

### Install skills for an agent

1. Apply — import the skill into the company library.

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/skills/import" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{"source": "org/repo/skill-name"}' | jq .
```

2. Apply — sync the desired skill set to the agent.

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/skills/sync" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{"desiredSkills": ["skill-name"]}' | jq .
```

### Set up a routine

1. Apply — create the routine.
2. Apply — add a schedule trigger.

```sh
# Step 1: create routine
ROUTINE_ID=$(curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/routines" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{"name": "Weekly digest", "agentId": "<agent-id>", "concurrencyPolicy": "skip", "catchUpPolicy": "skip"}' \
  | jq -r .id)

# Step 2: add schedule trigger
curl -sS -X POST "$PAPERCLIP_API_URL/api/routines/$ROUTINE_ID/triggers" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{"type": "schedule", "config": {"cron": "0 9 * * 1", "timezone": "America/New_York"}}' | jq .
```

### Wake an agent

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/agents/<agent-id>/heartbeat/invoke" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: operator-$(date +%s)" \
  -d '{}' | jq .
```

---

## Self-Test

Use these to verify the skill is wired up correctly before doing real operations.

### Read mode test

```sh
# Should return company dashboard JSON with no mutations
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/dashboard" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq .
```

Expected: dashboard JSON returned, no error, no side effects.

### Plan mode test (no mutation)

```sh
# Construct the payload and display it — do NOT send to API
echo '{"title":"Self-test task","status":"todo","priority":"low"}' | jq .
```

Expected: payload printed to terminal. No API call made, no issue created.

### Apply mode test

```sh
# Create a self-test issue
ISSUE_ID=$(curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: self-test-$(date +%s)" \
  -d '{"title":"Operator skill self-test","status":"todo","priority":"low"}' | jq -r .id)

echo "Created issue: $ISSUE_ID"

# Clean up: cancel the self-test issue
curl -sS -X PATCH "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: self-test-cleanup-$(date +%s)" \
  -d '{"status":"cancelled","comment":"Self-test cleanup."}' | jq '{id, status}'
```

Expected: issue ID returned on create, then status `cancelled` on cleanup.
