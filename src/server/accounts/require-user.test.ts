import { describe, expect, it } from 'vitest';
import { decidePageAccess, type PagePath } from './require-user';

/**
 * Every redirect case, as a table. The helper that performs the redirect is four
 * lines over this function, so this is where the rules are actually tested.
 */
describe('decidePageAccess', () => {
  const cases: Array<{
    name: string;
    signedIn: boolean;
    hasCharacter: boolean;
    path: PagePath;
    expected: string;
  }> = [
    {
      name: 'signed out on / is allowed',
      signedIn: false,
      hasCharacter: false,
      path: '/',
      expected: 'allow',
    },
    {
      name: 'signed out on /login is allowed',
      signedIn: false,
      hasCharacter: false,
      path: '/login',
      expected: 'allow',
    },
    {
      name: 'signed out on /home goes to login',
      signedIn: false,
      hasCharacter: false,
      path: '/home',
      expected: '/login',
    },
    {
      name: 'signed out on /create-character goes to login',
      signedIn: false,
      hasCharacter: false,
      path: '/create-character',
      expected: '/login',
    },
    {
      name: 'signed in without a character on /home goes to create-character',
      signedIn: true,
      hasCharacter: false,
      path: '/home',
      expected: '/create-character',
    },
    {
      name: 'signed in without a character on /create-character is allowed',
      signedIn: true,
      hasCharacter: false,
      path: '/create-character',
      expected: 'allow',
    },
    {
      name: 'signed in without a character on /login goes to create-character',
      signedIn: true,
      hasCharacter: false,
      path: '/login',
      expected: '/create-character',
    },
    {
      name: 'signed in with a character on /home is allowed',
      signedIn: true,
      hasCharacter: true,
      path: '/home',
      expected: 'allow',
    },
    {
      name: 'signed in with a character on /login goes home',
      signedIn: true,
      hasCharacter: true,
      path: '/login',
      expected: '/home',
    },
    {
      name: 'signed in with a character on /create-character goes home',
      signedIn: true,
      hasCharacter: true,
      path: '/create-character',
      expected: '/home',
    },
    {
      name: 'signed in with a character on / is allowed',
      signedIn: true,
      hasCharacter: true,
      path: '/',
      expected: 'allow',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const decision = decidePageAccess({
        signedIn: testCase.signedIn,
        hasCharacter: testCase.hasCharacter,
        path: testCase.path,
      });

      if (testCase.expected === 'allow') {
        expect(decision).toEqual({ action: 'allow' });
      } else {
        expect(decision).toEqual({ action: 'redirect', to: testCase.expected });
      }
    });
  }
});
