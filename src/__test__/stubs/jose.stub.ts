/**
 * Jest stub for the `jose` package.
 *
 * `jose` v6 ships pure ESM (`export { ... }`) that ts-jest's CommonJS transform
 * cannot parse, so importing anything that transitively pulls in `jose` (e.g.
 * PrivyService → PrivyAuthStrategy → the WebSocket gateway) blows up suites at
 * load time. The real `jose` is only exercised by PrivyService, which is always
 * mocked in unit tests, so a no-op stub is safe and removes the per-file
 * `jest.mock("jose")` boilerplate.
 */

export const importSPKI = jest.fn();
export const jwtVerify = jest.fn();
export const createRemoteJWKSet = jest.fn();
