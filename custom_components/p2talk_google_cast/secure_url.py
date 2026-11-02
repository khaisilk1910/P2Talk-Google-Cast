"""Safe, explicit HTTPS entry point for browser microphone capture.

A browser can capture audio only when the *page origin* is secure.
This builds a link back into the same Home Assistant panel; it is not an
alternate audio endpoint and does not proxy credentials or recorded audio.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from .const import CONF_MIC_HTTPS_URL, PANEL_PATH


def secure_origin(value: str) -> str:
    """Validate an HTTPS origin, without paths, credentials or parameters."""
    if not isinstance(value, str) or not value or len(value) > 256 or any(c.isspace() for c in value):
        raise vol.Invalid("Enter a valid HTTPS Home Assistant origin")
    try:
        parts = urlsplit(value)
        host = parts.hostname
        port = parts.port  # raises ValueError on invalid port
    except ValueError as err:
        raise vol.Invalid("Invalid HTTPS URL") from err
    if (parts.scheme != "https" or not host or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment
            or parts.path not in ("", "/") or chr(92) in value):
        raise vol.Invalid("Use only an HTTPS origin, such as https://ha.example.com")
    if any(char in parts.netloc for char in "?#@"):
        raise vol.Invalid("Invalid HTTPS hostname")
    # Netloc is retained so explicit non-default TLS ports continue to work.
    return urlunsplit(("https", parts.netloc.lower(), "", "", ""))


def optional_secure_origin(value: str) -> str:
    """Empty means use Home Assistant URLs rather than another setting."""
    if value == "":
        return ""
    return secure_origin(value)


def microphone_https_panel_url(hass, options) -> str | None:
    """Prefer admin-configured HTTPS, then HA's internal or external URL.

    No redirects are made by the backend; the frontend navigates only on a
    microphone button press, never during startup or background activity.
    """
    for candidate in (
        options.get(CONF_MIC_HTTPS_URL),
        getattr(hass.config, "internal_url", None),
        getattr(hass.config, "external_url", None),
    ):
        if not candidate:
            continue
        try:
            origin = secure_origin(candidate)
        except vol.Invalid:
            continue
        return f"{origin}/{PANEL_PATH}"
    return None
