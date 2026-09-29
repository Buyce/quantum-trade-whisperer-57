"""P-Trades direct MT5 bridge — read-only foundation.

Runs beside a logged-in MetaTrader 5 desktop terminal (normally on Windows/VPS).
It reads broker truth and can POST versioned snapshots outbound to P-Trades.

Deliberately absent in v1:
- order_send
- position modification
- pending-order creation/cancellation
- credential collection

Trading is not enabled merely by running this agent.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

import MetaTrader5 as mt5

PROTOCOL_VERSION = 1


class BridgeFatalError(RuntimeError):
    pass


class BridgeTransientError(RuntimeError):
    pass


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def finite(value: Any) -> float | None:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    except (TypeError, ValueError):
        return None


def mask_login(login: Any) -> str | None:
    if login is None:
        return None
    value = str(login)
    return "***" + value[-3:] if value else None


def account_key(bridge_id: str, login: Any, server: Any) -> str:
    """Stable pseudonymous key; never transmit the full broker login."""
    raw = f"{bridge_id}|{login}|{server or ''}".encode("utf-8")
    return "mt5_" + hashlib.sha256(raw).hexdigest()[:24]


def mode_name(value: Any) -> str:
    mapping = {
        getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", object()): "demo",
        getattr(mt5, "ACCOUNT_TRADE_MODE_REAL", object()): "live",
        getattr(mt5, "ACCOUNT_TRADE_MODE_CONTEST", object()): "contest",
    }
    return mapping.get(value, "unknown")


def side_name(value: Any) -> str:
    if value == getattr(mt5, "POSITION_TYPE_BUY", None):
        return "long"
    if value == getattr(mt5, "POSITION_TYPE_SELL", None):
        return "short"
    return "unknown"


def require_terminal() -> None:
    path = os.getenv("P_TRADES_MT5_PATH")
    ok = mt5.initialize(path) if path else mt5.initialize()
    if not ok:
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")


def snapshot(bridge_id: str, sequence: int) -> dict[str, Any]:
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    if account is None or terminal is None:
        raise RuntimeError(f"MT5 account/terminal unavailable: {mt5.last_error()}")

    observed = iso_now()
    positions = mt5.positions_get()
    orders = mt5.orders_get()
    if positions is None or orders is None:
        raise RuntimeError(f"MT5 positions/orders unavailable: {mt5.last_error()}")

    return {
        "protocolVersion": PROTOCOL_VERSION,
        "bridgeId": bridge_id,
        "sequence": sequence,
        "observedAt": observed,
        "terminal": {
            "connected": bool(getattr(terminal, "connected", False)),
            "tradeAllowed": bool(getattr(terminal, "trade_allowed", False)),
            "build": getattr(terminal, "build", None),
            "name": getattr(terminal, "name", None),
            # Never transmit the local terminal filesystem path.
            "path": None,
        },
        "account": {
            "provider": "mt5_direct",
            "observedAt": observed,
            # Account key is only a correlation key. UI should continue masking it.
            "accountKey": account_key(bridge_id, account.login, getattr(account, "server", None)),
            "platform": "mt5",
            "mode": mode_name(account.trade_mode),
            "loginMasked": mask_login(account.login),
            "server": getattr(account, "server", None),
            "broker": getattr(account, "company", None),
            "currency": getattr(account, "currency", None),
            "balance": finite(account.balance),
            "equity": finite(account.equity),
            "margin": finite(account.margin),
            "freeMargin": finite(account.margin_free),
            "marginLevel": finite(account.margin_level),
            "leverage": int(account.leverage) if account.leverage else None,
            "tradeAllowed": bool(getattr(account, "trade_allowed", False)),
        },
        "positions": [
            {
                "provider": "mt5_direct",
                "observedAt": observed,
                "id": str(p.ticket),
                "symbol": p.symbol,
                "side": side_name(p.type),
                "volume": float(p.volume),
                "openPrice": finite(p.price_open),
                "currentPrice": finite(p.price_current),
                "stopLoss": finite(p.sl),
                "takeProfit": finite(p.tp),
                "profit": finite(p.profit),
            }
            for p in positions
        ],
        "orders": [
            {
                "provider": "mt5_direct",
                "observedAt": observed,
                "id": str(o.ticket),
                "symbol": o.symbol,
                "type": str(o.type),
                "volume": float(o.volume_current),
                "openPrice": finite(o.price_open),
                "stopLoss": finite(o.sl),
                "takeProfit": finite(o.tp),
            }
            for o in orders
        ],
    }


def post_snapshot(url: str, token: str, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "P-Trades-MT5-Bridge/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise BridgeTransientError(
                    f"P-Trades bridge ingest returned HTTP {response.status}"
                )
    except urllib.error.HTTPError as exc:
        # Authentication, replay/mode mismatch and malformed snapshots require
        # operator intervention. Retrying them would only hammer the endpoint.
        if exc.code in (400, 401, 409, 413):
            raise BridgeFatalError(f"P-Trades refused bridge snapshot (HTTP {exc.code})") from exc
        raise BridgeTransientError(f"P-Trades ingest unavailable (HTTP {exc.code})") from exc
    except urllib.error.URLError as exc:
        raise BridgeTransientError("P-Trades ingest is temporarily unreachable") from exc


def main() -> None:
    bridge_id = os.environ["P_TRADES_BRIDGE_ID"]
    url = os.getenv("P_TRADES_BRIDGE_INGEST_URL")
    token = os.getenv("P_TRADES_BRIDGE_TOKEN")
    interval = max(2, int(os.getenv("P_TRADES_BRIDGE_INTERVAL_SECONDS", "5")))

    require_terminal()
    sequence = 0
    pending: dict[str, Any] | None = None
    try:
        while True:
            try:
                # Keep the exact payload until the cloud acknowledges it. If the
                # response is lost after commit, retrying identical JSON at the
                # same sequence is idempotent server-side.
                if pending is None:
                    pending = snapshot(bridge_id, sequence)
                if url and token:
                    post_snapshot(url, token, pending)
                    print(f"snapshot {sequence} accepted at {pending['observedAt']}")
                else:
                    # Diagnostic mode: no cloud transport, no trading.
                    print(json.dumps(pending, separators=(",", ":")))
                sequence += 1
                pending = None
            except BridgeFatalError:
                raise
            except (BridgeTransientError, RuntimeError) as exc:
                print(f"bridge degraded: {exc}")
                mt5.shutdown()
                time.sleep(interval)
                require_terminal()
                continue
            time.sleep(interval)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
