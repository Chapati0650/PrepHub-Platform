import { DesmosCalculator } from "./desmos-calculator";
import { FourFunctionCalculator } from "./four-function-calculator";

// Real Desmos needs a registered API key (see .env.example) — falls back to
// the four-function calculator when one isn't configured, same approved
// fallback described in PRD-012 §21 / PRD-006. NEXT_PUBLIC_ env vars are
// inlined at build time, so this check is static and identical on server
// and client renders (no hydration-mismatch risk).
export function Calculator() {
  return process.env.NEXT_PUBLIC_DESMOS_API_KEY ? <DesmosCalculator /> : <FourFunctionCalculator />;
}
