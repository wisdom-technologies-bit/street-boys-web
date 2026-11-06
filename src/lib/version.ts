import pkg from '../../package.json';

/**
 * The application version, taken from package.json so the two cannot drift.
 * It is public information: the health check returns it and nothing else.
 */
export const APP_VERSION: string = pkg.version;
