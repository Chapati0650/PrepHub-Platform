/**
 * What a session's server action returns, instead of throwing, when the
 * student can't go on for a reason they should be told about: the teacher
 * closed the homework, Premium lapsed partway through a set, the Diagnostic
 * was finished in another tab.
 *
 * A thrown error can't carry this. In a production build Next replaces a
 * server action's error message with a generic one, so the runner would only
 * ever know "something failed". Returned as data, the message reaches the
 * student and the runner can offer the one link that helps.
 */
export type SessionBlocked = {
  blocked: {
    message: string;
    href: string;
    linkLabel: string;
  };
};

export function sessionBlocked(message: string, href: string, linkLabel: string): SessionBlocked {
  return { blocked: { message, href, linkLabel } };
}

export function isSessionBlocked(value: unknown): value is SessionBlocked {
  return typeof value === "object" && value !== null && "blocked" in value;
}
