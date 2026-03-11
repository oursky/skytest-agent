# Runner Shutdown Semantics

## Problem

`skytest stop runner <id>` stopped only the local runner process.  
Server runner status remained `ONLINE` until heartbeat freshness expired, so Team Runners UI could show a recently stopped runner as online for up to the freshness window.

## Current Behavior

Stop flow now has an explicit server shutdown signal:

1. CLI `stop runner` calls `POST /api/runners/v1/shutdown` using the stored runner token.
2. Server marks the runner record `status = OFFLINE` immediately.
3. Team availability cache is invalidated so UI can reflect offline state without waiting for cache TTL.
4. CLI still terminates the local process as before.

If shutdown notify fails, CLI still stops the process and fallback heartbeat freshness logic still applies.

## Claim Safety

Claim SQL now requires the runner row to be `ONLINE` at claim time.  
This prevents an explicitly stopped runner from claiming new jobs during claim long-poll windows.
