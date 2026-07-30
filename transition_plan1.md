# Phase 4: Per-User Decisions Fix

This plan covers removing the hardcoded `DEFAULT_PERSON_ID` and tying the application's core actions (decisions, preferences, and identity) directly to the authenticated user's session.

## User Review Required

> [!IMPORTANT]
> The hardcoded ID `swapnil-shukla` was used during early development to fake the user context. Replacing this with the actual authenticated user ID means that if a new user logs in, they will have their own distinct timeline and shortlists. 
> Please approve if you are ready to move from a single-tenant testbed to a true multi-tenant application context.

## Proposed Changes

### Intelligence & Decisions Layer

#### [MODIFY] [decisions-server.ts](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/decisions-server.ts)
- Remove `const DEFAULT_PERSON_ID = "swapnil-shukla"`.
- Update `getDecisionsFn`, `saveDecisionFn`, `syncDecisionsFn`, `undoDecisionFn`, and `clearDecisionsFn` to read the session cookie (`SESSION_COOKIE_NAME`).
- Validate the session via `validateSessionToken(token)`.
- Pass the actual authenticated `session.userId` to the underlying repository calls instead of the default ID.
- Throw or return an error gracefully if the user is unauthenticated.

#### [MODIFY] [profile-server.ts](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/profile-server.ts)
- Replace fallback `userId: currentState.session?.userId || "swapnil-shukla-dev"` with strict enforcement of the `session.userId`.

#### [MODIFY] [identity-engine.ts](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/identity-engine.ts)
- Remove the hardcoded `userId: "swapnil-shukla-dev"` fallback.

#### [MODIFY] [cip.ts](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/cip.ts)
- Remove any lingering `swapnil-shukla` hardcoded defaults.

### UI / Auth Flow

#### [MODIFY] [login.tsx](file:///c:/Users/swapn/Downloads/radar-local-v2/src/routes/login.tsx)
- Ensure the magic link fallback or old dev tools that use the hardcoded ID are either removed or safely cordoned off, ensuring new OAuth flow is the primary path.

## Verification Plan

### Automated Tests
- `npx tsc --noEmit` will run to verify all TypeScript definitions continue to compile smoothly.
- `npm run test:eqe` will run to ensure the evaluation engine still executes without crashes.

### Manual Verification
- Log in with the newly functioning Google Auth pipeline.
- Verify that shortlisting an opportunity on the dashboard correctly attributes the swipe to the actual Google `user_id` in the database.
- Refresh the page to verify the decision persists for that specific user.
