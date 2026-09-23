"""Read-only adapter over the in-house SalesCRM's REST API (same contract as the
sibling EKYC Approval App's backend/crm_client.py and the Account Parent-Mapping
Monitor app's backend/crm_client.py — see those modules' docstrings for the confirmed
shape):

  - Base path: <CRM_API_BASE_URL>/api/v1
  - Auth header: `X-API-Key: crm_...` (NOT `Authorization: Bearer ...`)
  - GET /objects/{object_type}/records            -> {items, total, page, page_size, has_next}
    (records come back with fields flattened at the top level for list endpoints)
  - GET /objects/{object_type}/records/{id}       -> {id, object_type, data: {...fields...}}

This app only ever reads Accounts and Opportunities — no PUT/POST methods exist here on
purpose, since Account write permission for this API key has never been confirmed (and
out of scope per the approved plan: lookup and flag only, no CRM writes).
"""
import asyncio
import os

import httpx

CRM_API_BASE_URL = os.getenv("CRM_API_BASE_URL", "").rstrip("/")
CRM_API_KEY = os.getenv("CRM_API_KEY", "")

PAGE_SIZE = 100
# Confirmed live (via the sibling Monitor app): this CRM tenant holds 125k+ Indonesia
# Accounts alone (~1,250 pages per full sync). Sequential one-page-at-a-time fetching
# would take ~20+ minutes; fetch pages concurrently (bounded so we don't hammer the CRM
# API) instead. Kept at 4 (not higher) — the Monitor app confirmed live a 429 on page 1
# even at higher concurrency.
MAX_CONCURRENT_PAGES = 4
# Confirmed live (Monitor app): a 429 on page 1 (before any concurrent fan-out even
# starts) that still 429'd after a 6-attempt/60s-cap backoff — the rate-limit window
# this CRM enforces outlasts a ~1-minute retry budget. Widened substantially (worst
# case ~19 min of cumulative backoff) so a real sync can outlast a longer cooldown;
# this runs in the background with no request timeout, so a slow-but-successful sync
# is fine.
PAGE_RETRY_ATTEMPTS = 10
PAGE_RETRY_BASE_DELAY_SECONDS = 3.0
PAGE_RETRY_MAX_DELAY_SECONDS = 180.0

# Single-record lookups (ID resolution, live fallback) are on the request path for
# /api/lookup, so they get a much smaller retry budget than the background sync pull —
# a user waiting on a lookup shouldn't sit through minutes of backoff.
RECORD_RETRY_ATTEMPTS = 3
RECORD_RETRY_BASE_DELAY_SECONDS = 1.0


def _trim(record: dict) -> dict:
    """Each Account record carries 50+ fields (including a large full-text search
    vector) — only the ones this app uses are kept, so a full 125k+ Account pull
    doesn't hold every field in memory at once."""
    return {
        "id": record.get("id"),
        "name": record.get("name"),
        "owner_id": record.get("owner_id"),
        "owner_name": record.get("owner_name"),
        "parent_account_id": record.get("parent_account_id"),
        "phone": record.get("phone"),
        "tax_id": record.get("tax_id"),
        "identification_number": record.get("identification_number"),
        "created_at": record.get("created_at"),
    }


async def _retry_get(
    client: httpx.AsyncClient, path: str, params: dict, attempts: int, base_delay: float,
    max_delay: float = PAGE_RETRY_MAX_DELAY_SECONDS,
) -> httpx.Response:
    """Retries server errors, rate limiting, and network errors with exponential
    backoff (honoring Retry-After on a 429 when the CRM sends one); other 4xx (bad
    request/auth/not-found) is not retried — that won't fix itself, and a 404 is a
    meaningful "record doesn't exist" answer the caller needs to see."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = await client.get(path, params=params)
            if resp.status_code >= 500 or resp.status_code == 429:
                last_error = httpx.HTTPStatusError(
                    f"Server error '{resp.status_code}'", request=resp.request, response=resp
                )
            else:
                return resp
        except httpx.HTTPError as e:
            last_error = e
        if attempt < attempts - 1:
            delay = min(base_delay * (2**attempt), max_delay)
            retry_after = getattr(last_error, "response", None) and last_error.response.headers.get("Retry-After")
            if retry_after:
                try:
                    delay = max(delay, min(float(retry_after), max_delay))
                except ValueError:
                    pass
            await asyncio.sleep(delay)
    raise last_error


class CrmClient:
    def __init__(self) -> None:
        self._configured = bool(CRM_API_BASE_URL and CRM_API_KEY)

    @property
    def configured(self) -> bool:
        return self._configured

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=f"{CRM_API_BASE_URL}/api/v1",
            headers={"X-API-Key": CRM_API_KEY},
            timeout=30.0,
        )

    async def list_all_accounts(self, record_type_id: int | None = None) -> list[dict]:
        """Fetches every Account the API key's assigned user can see (trimmed to the
        fields this app uses). Called on every sync (scheduled or manual) rather than
        trying to fetch only "new" records — Account has no useful equality filter for
        that, and a full pull also picks up parent_account_id / owner changes made
        manually in CRM after a prior lookup.

        This CRM tenant is shared across multiple countries. Filter by `record_type_id`
        (the CRM's own Record Type foreign key — 10 is Indonesia, confirmed live),
        NOT the free-text `account_record_type` field: that field is manually typed by
        Sales and is sometimes left blank on newer Accounts, silently dropping genuine
        Indonesia Accounts out of every sync. record_type_id is the CRM's own foreign
        key, always populated."""
        if not self._configured:
            return []
        params: dict = {"page_size": PAGE_SIZE}
        if record_type_id is not None:
            params["record_type_id"] = record_type_id

        async with self._client() as client:
            first = await _retry_get(
                client, "/objects/Account/records", {**params, "page": 1},
                PAGE_RETRY_ATTEMPTS, PAGE_RETRY_BASE_DELAY_SECONDS,
            )
            first.raise_for_status()
            body = first.json()
            total = body.get("total", 0)
            page_size = body.get("page_size") or PAGE_SIZE
            total_pages = max(1, -(-total // page_size))  # ceil division

            records = [_trim(r) for r in body.get("items", [])]
            if total_pages <= 1:
                return records

            semaphore = asyncio.Semaphore(MAX_CONCURRENT_PAGES)

            async def fetch_page(page_num: int) -> list[dict]:
                async with semaphore:
                    resp = await _retry_get(
                        client, "/objects/Account/records", {**params, "page": page_num},
                        PAGE_RETRY_ATTEMPTS, PAGE_RETRY_BASE_DELAY_SECONDS,
                    )
                    resp.raise_for_status()
                    return [_trim(r) for r in resp.json().get("items", [])]

            pages = await asyncio.gather(*[fetch_page(p) for p in range(2, total_pages + 1)])
            for page_records in pages:
                records.extend(page_records)

        return records

    async def list_opportunities_by_account(self, account_id: int, opportunity_type: str | None = None) -> list[dict]:
        """GET /objects/Opportunity/records?account_id=X[&type=Y] — used to enrich a
        single-lookup's duplicate-match table with each Account's Opportunity stage.
        One Account rarely has more than a handful of Opportunities, so a single
        page_size=100 page is assumed to cover it (no pagination). Uses the same small
        retry budget as get_record since this is on the request path for /api/lookup,
        run once per Account shown in the duplicate-match tables."""
        if not self._configured:
            return []
        params: dict = {"account_id": account_id, "page_size": 100}
        if opportunity_type is not None:
            params["type"] = opportunity_type
        async with self._client() as client:
            resp = await _retry_get(
                client, "/objects/Opportunity/records", params,
                RECORD_RETRY_ATTEMPTS, RECORD_RETRY_BASE_DELAY_SECONDS,
            )
            resp.raise_for_status()
            return resp.json().get("items", [])

    async def get_record(self, object_type: str, record_id: int) -> dict | None:
        """GET /objects/{object_type}/records/{id} -> {..., data: {...fields...}}.
        Used for live Opportunity->Account resolution and as a fallback when a looked-up
        Account isn't in the local mirror yet (not yet synced, or a different record
        type). Returns None on a 404 (record doesn't exist / not visible to this API
        key) or when CRM isn't configured."""
        if not self._configured:
            return None
        async with self._client() as client:
            resp = await _retry_get(
                client, f"/objects/{object_type}/records/{record_id}", {},
                RECORD_RETRY_ATTEMPTS, RECORD_RETRY_BASE_DELAY_SECONDS,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json().get("data")


crm_client = CrmClient()
