/**
 * The avatar options now live in `src/shared/avatar-options.ts`, because the
 * character page draws the picker and the client may only import from
 * `src/shared`. This module stays as the server-side name for them, so every
 * existing import and test keeps working unchanged.
 */
export * from '@/shared/avatar-options';
