# Changelog

All notable changes to OpenSolvency are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere to
semantic versioning once it reaches 1.0.

## [0.1.0] — 2026-06-24

First named release (graduated from the `opensolvency` placeholder). The kernel,
gate, audit chain, rails, agent loop, and the Networth-derived behavioural harness
were built across the preceding milestones; this release adds the production
hardening and integration surfaces.

### Added
- **Editor integration (ACP)** — an Agent Client Protocol stdio surface
  (`src/acp/`) so editors/IDEs can drive the gate-enforced finance agent in-editor,
  alongside the existing MCP server (Claude Code / Cursor) and HTTP ingress.
- **OpenAPI 3.1 document** served at `GET /openapi.json` describing the ingress
  surface for machine discovery.
- **Ingress authentication** — an operator-set bearer token gates the HTTP
  transport (`/health` always open); the surface stays open on loopback when no
  token is configured.
- **Operator notifications** — an injected `Notifier` seam (no-op default, console
  and webhook implementations) pings the operator out-of-band when a payment is
  routed to confirmation, so the pending queue need not be polled. Best-effort:
  it can never block or alter a gate decision.
- **OTLP tracer** — a real `Tracer` that ships executor lifecycle events to an
  OpenTelemetry collector over OTLP/HTTP (JSON), with no hard `@opentelemetry/*`
  dependency.
- Packaging: `LICENSE` (MIT), this changelog, and a publishable package manifest.

### Notes
- A Postgres-backed store is deferred: the `Store`/executor path is synchronous by
  design (it keeps the gate pure), so a Postgres backend requires an async-store
  refactor and is tracked as its own task.
