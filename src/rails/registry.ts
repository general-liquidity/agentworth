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
    /** The provider that serves this rail kind: the routed one if set,
     * otherwise the first registered provider of that kind. */
    get(rail: RailKind): PaymentProvider | undefined {
      const routed = routes[rail];
      if (routed && byId.has(routed)) return byId.get(routed);
      return providers.find((p) => p.capabilities.rail === rail);
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
