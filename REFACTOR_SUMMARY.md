# Refactoring Complete

The project structure has been successfully refactored.

## Changes

1.  **Project Structure**:
    *   Moved `src/server.ts` (or `src/server/index.ts`) to `src/core/server.ts`.
    *   Created `src/index.ts` as the new entry point.
    *   Organized `handlers` into `src/handlers/`.
    *   Organized `services` into `src/services/` (auth, ai, quota).
    *   Organized `converters` into `src/converters/`.
    *   Organized `utils` into `src/utils/`.
    *   Configuration files in `src/config/`.

2.  **Code Refactoring**:
    *   Updated all import paths to reflect the new structure.
    *   Refactored `src/utils/memory-manager.ts` to use TypeScript Enums for `MemoryPressure`.
    *   Refactored `src/utils/http-client.ts` to fix type definitions.
    *   Refactored `src/services/auth/oauth.ts`, `jwt.ts` and `quota/quota-manager.ts` to fix imports and translate comments.
    *   Renamed files to kebab-case where appropriate (e.g. `memoryManager.ts` -> `memory-manager.ts`, `token_manager.ts` -> `token-manager.ts`).

3.  **Localization**:
    *   Translated comments in all touched files from Japanese/Chinese to English.
    *   Updated log messages to English (mostly).
    *   Updated locale usage in `logger.ts` to `en-US`.

4.  **Configuration**:
    *   Updated `package.json` to point `main`, `bin`, and `scripts` to `src/index.ts`.
    *   Updated `tsconfig.json` to include necessary files.

## Verification

You can now start the server using:

```bash
npm start
# or
npm run dev
```

Ensure `config/constants.ts` and `.env` are correctly set up.
