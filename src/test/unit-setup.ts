import { applyTestEnv } from './test-env';

// Every unit test gets the same fixed environment, whatever the shell holds.
applyTestEnv();
