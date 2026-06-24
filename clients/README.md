# Language clients

Thin REST clients for the OpenSolvency HTTP ingress, for the half of the agent
ecosystem that isn't TypeScript. They add **no authority** — every payment they
submit runs through the same gate (auto-execute inside a mandate, park for approval,
or block). Point them at a running `opensolvency serve` (set an ingress token for
anything non-loopback).

Both are dependency-light (Python: standard library only; Go: standard library
only) and track the OpenAPI document the ingress serves at `/openapi.json`.

## Python (`clients/python/`)

```python
from opensolvency import OpenSolvencyClient

os = OpenSolvencyClient("http://127.0.0.1:8787", token="...")
res = os.pay(payee="tesco", payee_class="groceries", amount=8000,
             rationale="the weekly grocery shop")
print(res["outcome"])   # settled | pending | blocked | failed
print(os.status(), os.ready())
```

Idempotency keys are generated per `pay()` (override with `idempotency_key=`).

## Go (`clients/go/`)

```go
import "github.com/general-liquidity/opensolvency-go"

c := opensolvency.New("http://127.0.0.1:8787", "token")
res, err := c.Pay(opensolvency.PaymentIntent{
    Payee: "tesco", PayeeClass: "groceries", Amount: 8000,
    Currency: "GBP", Rail: "card", Rationale: "the weekly grocery shop",
}, "")
// res.Outcome is settled | pending | blocked | failed
```

> The TypeScript SDK (`@general-liquidity/opensolvency`) is the in-process,
> full-feature surface; these REST clients are for cross-language hosts that talk to
> a running ingress. A `blocked` outcome is a normal result, not an error.
