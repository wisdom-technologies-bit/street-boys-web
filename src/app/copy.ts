/**
 * Every word a player reads.
 *
 * One file, on purpose: Pidgin and the other Nigerian languages are the next
 * language pass, and a translator should be able to open a single file rather
 * than hunt strings out of components. No component may hold a literal that a
 * player sees, and nothing here may contain an apostrophe written as a curly
 * quote, because a phone keyboard cannot type one.
 */

export const copy = {
  appName: 'Street Boys',
  tagline: 'A street-life story set in Nigeria. Make a name for yourself, one day at a time.',

  landing: {
    play: 'Play',
    continuePlaying: 'Continue',
    comingSoon: 'More of the city is coming soon.',
  },

  auth: {
    signInHeading: 'Sign in',
    emailLabel: 'Email address',
    emailHint: 'We send a six-digit code. No password to remember.',
    emailPlaceholder: 'you@example.com',
    sendCode: 'Send me a code',
    sending: 'Sending...',
    codeHeading: 'Enter your code',
    codeSentTo: (email: string) => `We sent a six-digit code to ${email}.`,
    codeLabel: 'Six-digit code',
    codeHint: 'Check your inbox. If you do not see it, look in spam.',
    codePlaceholder: '123456',
    verify: 'Sign in',
    verifying: 'Checking...',
    resend: 'Send a new code',
    resendIn: (seconds: number) => `Send a new code in ${seconds}s`,
    differentEmail: 'Use a different email',
    detailsHeading: 'Almost there',
    detailsIntro: 'A few details before your first day.',
    termsLabel: 'I accept the terms of use and the privacy notice.',
    termsLink: 'Terms of use',
    privacyLink: 'Privacy notice',
    ageLegend: 'Your age',
    ageAdult: 'I am 18 or older',
    ageMinor: 'I am under 18',
    ageNote: 'Some features may be limited for players under 18.',
    finish: 'Create my account',
    finishing: 'Creating...',
    signOut: 'Sign out',
  },

  character: {
    heading: 'Create your character',
    intro: 'This is the name the street will know you by.',
    nameLabel: 'Name',
    nameRules: '3 to 20 characters. Letters, numbers, spaces and underscores.',
    namePlaceholder: 'e.g. Ada',
    skinTone: 'Skin tone',
    hair: 'Hair',
    outfit: 'Outfit',
    preview: 'Your character',
    previewSummary: (skin: number, hair: number, outfit: number) =>
      `Skin tone ${skin}, hair ${hair}, outfit ${outfit}`,
    submit: 'Enter the street',
    submitting: 'Creating...',
    option: (label: string, value: number) => `${label} ${value}`,
  },

  home: {
    heading: 'Home',
    balanceLabel: 'Balance',
    avatarLabel: 'Your avatar',
    greeting: (name: string) => `Welcome, ${name}.`,
    recentHeading: 'Recent money',
  },

  wallet: {
    heading: 'Wallet',
    balanceLabel: 'Balance',
    statementHeading: 'Statement',
    viewStatement: 'See all money in and out',
    emptyStatement: 'Nothing has moved yet. Your starting money will show here.',
    loadMore: 'Load more',
    loadingMore: 'Loading...',
    loadMoreFailed: 'That did not load. Try again.',
    setupPending: 'We are setting up your wallet, please refresh in a moment',
    restricted: 'Some actions are temporarily unavailable',
    /**
     * What a category is called to a player.
     *
     * The database holds the ledger's own names, which are implemented in
     * `src/server/ledger` and are not language. A player should never read
     * `onboarding_grant`: "Starting money" is what happened to them. Anything not
     * listed falls back to "Other" rather than showing an internal word, because a
     * new category must not become a leak of the schema.
     */
    categoryLabel: (category: string): string => {
      const labels: Record<string, string> = {
        onboarding_grant: 'Starting money',
        reversal: 'Correction',
        food: 'Food',
        transport: 'Transport',
        rent: 'Rent',
      };
      return labels[category] ?? 'Other';
    },
  },

  unavailable: {
    heading: 'Account unavailable',
    body: 'This account cannot be used right now. If you think this is a mistake, contact support.',
    home: 'Back to the start',
  },

  terms: {
    heading: 'Terms of use',
    draft: 'Draft: pending review by a Nigerian lawyer. Not final.',
    body: 'These terms are being written. Nothing on this page is binding yet.',
  },

  privacy: {
    heading: 'Privacy notice',
    draft: 'Draft: pending review by a Nigerian lawyer. Not final.',
    body: 'This notice is being written. Nothing on this page is binding yet.',
  },

  notFound: {
    heading: 'Page not found',
    body: 'That page does not exist.',
    home: 'Back to the start',
  },

  error: {
    heading: 'Something went wrong',
    body: 'Please try again.',
    retry: 'Try again',
  },

  errors: {
    /** The code was wrong, expired, already used, or too many attempts were made. */
    invalid_or_expired: 'That code is wrong or has expired. Ask for a new one.',
    rate_limited: (seconds: number) =>
      seconds > 0
        ? `Too many tries. Wait ${seconds} seconds and try again.`
        : 'Too many tries. Wait a moment and try again.',
    send_failed: 'We could not send the email. Try again in a minute.',
    email_not_supported:
      'That email address is not accepted. Use a personal address that can receive mail.',
    invalid_request: 'Check what you typed and try again.',
    unauthorized: 'Your session has ended. Sign in again.',
    forbidden: 'That request was blocked. Reload the page and try again.',
    network: 'No connection. Check your network and try again.',
    name_not_allowed: 'That name is not allowed. Try another one.',
    avatar_invalid: 'Choose a skin tone, hair style and outfit from the options.',
    name_taken: 'Someone already has that name. Try another one.',
    already_has_character: 'You already have a character.',
    unknown: 'Something went wrong. Try again.',
  },
} as const;
