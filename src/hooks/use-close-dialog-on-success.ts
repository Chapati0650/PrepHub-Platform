import { useState } from "react";

// A `useActionState`-bound <form> inside a Dialog (or an inline edit row) has
// no built-in close-on-success behavior. Calling setOpen(false) synchronously
// in a useEffect on `success` changing triggers react-hooks/set-state-in-effect
// (cascading-render lint rule), so instead we adjust state during render by
// tracking the previously-seen value, per React's "you might not need an
// effect" guidance.
export function useCloseDialogOnSuccess(success: boolean | undefined, setOpen: (open: boolean) => void) {
  const [prevSuccess, setPrevSuccess] = useState(success);
  if (success !== prevSuccess) {
    setPrevSuccess(success);
    if (success) setOpen(false);
  }
}
