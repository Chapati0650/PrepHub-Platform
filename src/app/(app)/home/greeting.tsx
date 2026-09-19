"use client";

import { useSyncExternalStore } from "react";

// "Good evening, Ada." — but the hour has to be the student's, and this page
// renders on a server whose clock is UTC. So the greeting is decided on the
// client, using the same useSyncExternalStore idiom CLAUDE.md prescribes for
// next-themes: the server snapshot is null (rendering the neutral "Welcome
// back"), the client snapshot is the local hour, and React swaps the text
// right after hydration without a setState-in-effect or a mismatch warning.
const subscribe = () => () => {};
const getServerHour = () => null;
const getClientHour = () => new Date().getHours();

function salutation(hour: number | null): string {
  if (hour === null) return "Welcome back";
  if (hour < 5) return "Good late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export function Greeting({ name }: { name: string }) {
  const hour = useSyncExternalStore(subscribe, getClientHour, getServerHour);
  return (
    <>
      {salutation(hour)}, {name}.
    </>
  );
}
