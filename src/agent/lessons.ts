// Self-evolution envelope — Tier-1 lessons (mutable) over a Tier-0 frozen floor.
// Lessons are short advisory guidance the agent (or operator) accumulates and that
// gets injected into the system prompt of future runs — a form of continual
// learning (the Hermes/ACE pattern). The CRITICAL invariant: lessons are STRINGS
// in a prompt. They can never alter the gate, deny-list, caps, or mandate
// semantics, which are code. So the agent can refine how it *advises* but can
// never weaken what it's *allowed to do*. (Asserted in lessons.test.ts.)

import type { Store } from "../core/store.ts";

const KEY = "agent.lessons";
const MAX_LESSONS = 20;

export function getLessons(store: Store): string[] {
  const raw = store.getMeta(KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export function addLesson(store: Store, text: string): void {
  const t = text.trim();
  if (!t) return;
  const lessons = getLessons(store).filter((l) => l !== t);
  lessons.push(t);
  store.setMeta(KEY, JSON.stringify(lessons.slice(-MAX_LESSONS)));
}
