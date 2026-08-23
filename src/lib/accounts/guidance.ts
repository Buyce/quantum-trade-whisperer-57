/**
 * Onboarding help text, kept as data so the wizard, the docs contract test and
 * any future surface all say the same thing.
 *
 * Wording rule: never ask for, hint at, or explain where to type a MetaTrader
 * PASSWORD inside P-Trades. The password is only ever entered on the broker
 * connection provider's own secure page.
 */

export interface HelpTopic {
  id: string;
  question: string;
  answer: string;
  /** Where the trader physically looks. */
  whereToLook: string[];
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "platform",
    question: "Where do I find whether my account is MT4 or MT5?",
    answer:
      "It is the trading app your broker gave you. If the app is called MetaTrader 4 choose MT4; if it is called MetaTrader 5 choose MT5. Picking the wrong one makes your broker refuse the login, so check the app's title bar or your broker's welcome email.",
    whereToLook: [
      "The title bar of your MetaTrader app",
      "Your broker's account-opening email",
      "Your broker's client area, under your account details",
    ],
  },
  {
    id: "server",
    question: "Where do I find my broker server name?",
    answer:
      "The server name is the exact text your MetaTrader app shows when you log in — for example 'MetaQuotes-Demo' or 'ICMarketsSC-Live12'. It must match character for character, including the dash and any number, or the broker will reject the connection.",
    whereToLook: [
      "MetaTrader: File → Login to Trade Account, the Server field",
      "MetaTrader mobile: Settings → your account → Server",
      "Your broker's account-opening email",
    ],
  },
  {
    id: "login",
    question: "Where do I find my account number (login)?",
    answer:
      "Your login is the numeric account number your broker issued, usually 6 to 10 digits. You enter it on your broker-connection provider's secure page, not in P-Trades.",
    whereToLook: [
      "MetaTrader: the Navigator panel, under Accounts",
      "Your broker's client area dashboard",
      "Your broker's account-opening email",
    ],
  },
  {
    id: "password",
    question: "Does P-Trades see my MetaTrader password?",
    answer:
      "No. P-Trades never receives, stores or logs your MetaTrader password. When you continue, you are handed to your broker-connection provider's own secure page and you type the password there. P-Trades only ever keeps the connection's identifier.",
    whereToLook: [],
  },
  {
    id: "investor",
    question: "What if I only have an investor (read-only) password?",
    answer:
      "That works for watching an account. P-Trades will read your balance, equity and open positions, and will clearly mark the account as read-only. It cannot place orders on an investor connection, and it will not pretend otherwise.",
    whereToLook: [],
  },
  {
    id: "demo-or-live",
    question: "Should I choose Demo or Live?",
    answer:
      "Choose whichever the account actually is. Your choice is only a starting point: once connected, your broker tells P-Trades what the account really is, and if the two disagree P-Trades stops and warns you instead of guessing.",
    whereToLook: [],
  },
  {
    id: "region",
    question: "Which region should I pick?",
    answer:
      "Pick the region closest to your broker's servers — London for most European and UK brokers, New York for most US brokers. It only affects connection speed, not your account.",
    whereToLook: [],
  },
];

export function helpTopic(id: string): HelpTopic | null {
  return HELP_TOPICS.find((t) => t.id === id) ?? null;
}

/** Regions P-Trades offers. Mirrors MetaApi's own region ids. */
export const CONNECTION_REGIONS = [
  { id: "london", label: "London (Europe / UK)" },
  { id: "new-york", label: "New York (Americas)" },
  { id: "singapore", label: "Singapore (Asia-Pacific)" },
] as const;

export type ConnectionRegionId = (typeof CONNECTION_REGIONS)[number]["id"];

export function isOfferedRegion(region: string): region is ConnectionRegionId {
  return CONNECTION_REGIONS.some((r) => r.id === region);
}

/** Plain-language statement of what this stage can and cannot do. */
export const STAGE_CAPABILITY_NOTE =
  "Connected accounts are in Observe mode: P-Trades reads what your broker reports and shows it back to you. It does not place, change or close any order on your account.";
