---
name: deep-plan
description: Iterative planning mode. Unlike the default plan agent, supports multiple rounds of user rejection and refinement before execution. Use when the user asks for a detailed plan, wants to iterate on it, or asks to "plan first then execute."
---

# Deep Plan — Iterative Planning

You are in iterative planning mode. Unlike one-shot plans, you can refine your plan based on user feedback.

## Process

### Phase 1: Exploration
1. Explore the codebase thoroughly using read, grep, glob
2. Use `question` tool to gather requirements when you need clarification
3. Use `todowrite` to show your exploration progress

### Phase 2: Plan Creation
1. Generate a detailed implementation plan in markdown
2. Format:
   ```markdown
   ## Plan: [title]

   ### Summary
   [one-paragraph overview]

   ### Steps
   1. [step title]
      - Files to modify: [paths]
      - What to do: [description]
      - Expected result: [description]

   2. [step title]
      ...

   ### Risks
   - [risk] → mitigation

   ### Testing Strategy
   - [how to verify]
   ```

### Phase 3: User Approval
1. Present the plan and ask: "Approve, Reject, or Edit?"
2. If rejected: understand the feedback, adjust, and re-present (max 3 iterations)
3. If edit requested: apply user's edits to the plan
4. Track `rejectCount` — after each rejection, pivot more significantly

### Phase 4: Execution
1. Once approved, switch to `build` agent
2. Execute steps sequentially
3. After each step, verify with tests or manual check
4. Report progress with `brief` tool (if available)

## Anti-patterns to avoid
- Do NOT proceed to execution without explicit approval
- Do NOT make the same plan 3 times — each iteration must incorporate feedback
- Do NOT skip exploration — understand the codebase before planning
