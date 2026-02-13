# Agent Guide

## Project Overview

This repo hosts a Cloud Run backend for a calorie-logging assistant. It exposes HTTP endpoints used by a Custom GPT and stores data in Firestore. The service is written in TypeScript, runs on Fastify, and uses pnpm scripts for dev/build/test/deploy. Daily totals are materialized in a `daily_totals` collection for fast summary queries.

Key endpoints:
- `GET /health`
- `GET /summary?date=YYYY-MM-DD`
- `GET /summary-range?start=YYYY-MM-DD&end=YYYY-MM-DD&include_empty=true&group=meal_type`
- `GET /summary-last?days=7&include_empty=true`
- `GET /list?date=YYYY-MM-DD&limit=50&offset=0`
- `GET /entries-range?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=200&offset=0`
- `POST /log`
- `POST /update`
- `POST /delete`

Auth:
- All non-health endpoints require header `X-Auth-Token`.

Storage:
- Firestore collections: `entries`, `daily_totals`.
- Composite index required on `entries` for `date` ascending + `timestamp` descending.

OpenAPI:
- `openapi.yaml` at repo root. Update this whenever endpoints or schemas change.

## Commands

- `pnpm dev` (local dev on port 3000)
- `pnpm test` (unit + functional tests)
- `pnpm run logs:tail` (stream Cloud Run logs)
- `pnpm run logs:recent` (last N minutes; set `LOG_MINUTES`)
- `pnpm deploy` (Cloud Run deploy)

## Agent Rules

- Keep `README.md` and `openapi.yaml` in sync with any API changes.
- Update tests when behavior changes.
- If you change endpoints, update this file with the new endpoint list.
- Keep auth header usage consistent (`X-Auth-Token`).
- Ensure Firestore index guidance remains accurate if queries change.
