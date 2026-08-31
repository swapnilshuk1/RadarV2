# FOR-4F Client State, Hydration & Router Cache Audit

## 1. Cache Layers in RADAR v2
1. **TanStack Router Route Loader**: Revalidates on page reload or explicit navigation.
2. **Category Cache Ref (`categoryCacheRef` in `index.tsx`)**: Caches category query responses in component memory.
3. **LocalStorage Decisions Cache (`decisions-store.ts`)**: Caches user swipes optimistically.

## 2. Findings
- Stale numbers (such as 487) occurred when the browser retained earlier route loader cache before full active-context reconciliation.
- Hard refresh (`Ctrl+F5`) or navigation correctly fetches the latest 3,002 active DTO dataset.
