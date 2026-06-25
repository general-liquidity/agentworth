// The rail registry. Holds many providers (keyed by protocol id) and routes a
// rail KIND (what a mandate authorizes: card/onchain/checkout) to the chosen
// provider. Multiple protocols can share a kind — Visa and Mastercard are both
// `card` — so the operator picks which one backs each kind via `routes`.

import type { RailKind } from "../core/types.ts";
import type { PaymentProvider } from "./provider.ts";

export function createRailRegistry(
  providers: PaymentProvider[],
  routes: Partial<Record<RailKind, string>> = {},
) {
  const byId = new Map<string, PaymentProvider>();
  for (const p of providers) byId.set(p.capabilities.id, p);

  return {
    /** The provider that serves this rail kind: the routed one if set, otherwise
     * the sole registered provider of that kind. Multiple protocols can share a
     * kind (`checkout` is served by ACP, UCP and MPP; `card` by Visa and
     * Mastercard), so when more than one is registered for a kind the operator
     * MUST disambiguate via `routes`. An ambiguous kind with no route resolves to
     * `undefined` — deterministic, and fail-safe in the executor (no provider →
     * `payment.failed`, never a silent first-registered pick in a money path). */
    get(rail: RailKind): PaymentProvider | undefined {
      const routed = routes[rail];
      if (routed && byId.has(routed)) return byId.get(routed);
      const ofKind = providers.filter((p) => p.capabilities.rail === rail);
      return ofKind.length === 1 ? ofKind[0] : undefined;
    },
    byId(id: string): PaymentProvider | undefined {
      return byId.get(id);
    },
    ids(): string[] {
      return [...byId.keys()];
    },
    rails(): RailKind[] {
      return [...new Set(providers.map((p) => p.capabilities.rail))];
    },
  };
}

export type RailRegistry = ReturnType<typeof createRailRegistry>;
