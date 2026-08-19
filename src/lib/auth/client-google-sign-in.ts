import { signIn, signOut } from "next-auth/react";

// Explicitly signs out before starting a new Google sign-in. Auth.js's core
// login handler silently *links* an OAuth account to whoever's already
// logged in in the current browser session, rather than switching identity
// to whichever account was just chosen (see @auth/core's handle-login.js —
// deliberate, documented behavior for "connect an additional provider to my
// account," not a bug). Confirmed as the exact cause of a real incident:
// repeated "Sign in with Google" testing while still logged in from a
// previous attempt silently merged several distinct Google accounts into
// one Owner account. /login and /signup only ever mean "sign in as
// whichever account I pick," never "link a provider to my current session,"
// so this always clears any existing session first.
export async function signInWithGoogle(callbackUrl: string): Promise<void> {
  await signOut({ redirect: false });
  await signIn("google", { callbackUrl });
}
