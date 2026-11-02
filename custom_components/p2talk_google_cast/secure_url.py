"""Home Assistant-configured HTTPS origin for the microphone panel.

Microphone access is governed by the current browser page's security context.
This URL is only a same-panel navigation target, never an audio endpoint.
Do not infer a target from request headers or accept arbitrary URLs from options.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from .const import PANEL_PATH


def secure_origin(value: str) -> str | None:
    """Return an HTTPS origin, rejecting paths and unsafe URL syntax."""
    if not isinstance(value, str) or not value or len(value) > 256 or any(c.isspace() for c in value):
        return None
    try:
        parts = urlsplit(value)
        host = parts.hostname
        _port = parts.port  # fail closed for malformed ports
    except ValueError:
        return None
    if (parts.scheme != "https" or not host or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment
            or parts.path not in ("", "/") or "\\" in value
            or any(char in parts.netloc for char in "?#@")):
        return None
    return urlunsplit(("https", parts.netloc.lower(), "", "", ""))


def configured_https_panel(hass) -> tuple[str | None, str]:
    """Use only HA-managed URL settings, not HACS options or cloud fallbacks.

    External HTTPS is preferred: it is normally reachable from both the local
    network and outside. An HTTPS internal URL is the fallback. Neither URL is
    guessed from HTTP, DNS, request headers or the browser's current origin.
    """
    for source, candidate in (
        ("external", getattr(hass.config, "external_url", None)),
        ("internal", getattr(hass.config, "internal_url", None)),
    ):
        origin = secure_origin(candidate)
        if origin:
            return f"{origin}/{PANEL_PATH}", source
    return None, "missing"


def microphone_https_panel_url(hass) -> str | None:
    """Return the HTTPS P2Talk panel URL or None if HA has none configured."""
    return configured_https_panel(hass)[0]


def configured_https_candidates(hass) -> list[str]:
    """Validated HTTPS panel URLs, external first, deduplicated."""
    result = []
    for candidate in (getattr(hass.config, "external_url", None),
                      getattr(hass.config, "internal_url", None)):
        origin = secure_origin(candidate)
        if origin:
            panel = f"{origin}/{PANEL_PATH}"
            if panel not in result:
                result.append(panel)
    return result
