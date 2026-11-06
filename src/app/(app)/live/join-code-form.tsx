"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinByCodeAction, type CodeState } from "./actions";

export function JoinCodeForm() {
  const [state, action, pending] = useActionState<CodeState, FormData>(joinByCodeAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="session-code" className="text-base">
        The six-character code on the board
      </label>
      <div className="flex flex-wrap gap-3">
        <Input
          id="session-code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC-DEF"
          className="h-12 max-w-48 font-mono text-lg tracking-widest uppercase md:text-lg"
          required
        />
        <Button type="submit" size="cta" disabled={pending}>
          {pending ? "Checking…" : "Go"}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-base text-destructive">
          {state.error}
        </p>
      )}
      {state.classCode && (
        <p role="status" className="rounded-2xl bg-surface-tint p-4 text-base">
          That session is for {state.className}, and you&apos;re not in that class yet.{" "}
          <Link href={`/join/${state.classCode}`} className="font-medium underline underline-offset-2">
            Join the class
          </Link>
          , then come back here.
        </p>
      )}
    </form>
  );
}
