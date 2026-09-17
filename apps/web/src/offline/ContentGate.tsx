import { type ContentIndex } from "@parlo/core";
import { use, type ReactNode } from "react";
import { ensureUnits } from "../content.ts";
import { progressUnits } from "./prefetch.ts";

/**
 * Écrans qui lisent les étapes ou les concepts complets de plusieurs unités (jeux, karaoké, examens,
 * démo) : les unités utiles sont chargées avant le rendu (au mieux : hors ligne, les unités absentes
 * restent en résumé et ces écrans font avec).
 */

type Scope = "progress" | "all";

const pending = new WeakMap<ContentIndex, Map<Scope, Promise<void>>>();
const done = new WeakMap<ContentIndex, Set<Scope>>();

function load(content: ContentIndex, scope: Scope): Promise<void> {
  const byScope = pending.get(content) ?? new Map<Scope, Promise<void>>();
  pending.set(content, byScope);
  let task = byScope.get(scope);
  if (!task) {
    task = (async () => {
      const units = scope === "all" ? content.curriculum.units.map((u) => u.id) : await progressUnits(content);
      await ensureUnits(content, units, { optional: true });
    })()
      .catch(() => undefined)
      .then(() => {
        const set = done.get(content) ?? new Set<Scope>();
        set.add(scope);
        done.set(content, set);
      });
    byScope.set(scope, task);
  }
  return task;
}

export function WithUnits({ content, scope = "progress", children }: { content: ContentIndex; scope?: Scope; children: ReactNode }) {
  if (content.split && !done.get(content)?.has(scope)) use(load(content, scope));
  return children;
}
