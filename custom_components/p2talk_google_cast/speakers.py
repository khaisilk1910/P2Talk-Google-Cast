"""Pure helpers for the speaker allowlist (no Home Assistant imports)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .const import CONF_SPEAKERS


def configured_speakers(options: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return safe, ordered entries; tolerate older configurations."""
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in options.get(CONF_SPEAKERS, []):
        if not isinstance(item, dict):
            continue
        entity = item.get("entity_id")
        if not isinstance(entity, str) or not entity.startswith("media_player.") or entity in seen:
            continue
        seen.add(entity)
        alias = item.get("name", "")
        volume = item.get("volume")
        result.append({
            "entity_id": entity,
            "name": alias.strip()[:64] if isinstance(alias, str) else "",
            "volume": float(volume) if isinstance(volume, (int, float)) and 0.05 <= volume <= 1 else None,
        })
    return result


def speaker_by_id(options: Mapping[str, Any], entity_id: str) -> dict[str, Any] | None:
    """Enforce authorization to configured speakers independently of frontend."""
    return next((s for s in configured_speakers(options) if s["entity_id"] == entity_id), None)


def upsert_speaker(options: Mapping[str, Any], entry: dict[str, Any], original: str | None = None) -> dict[str, Any]:
    """Replace/add speaker without losing other settings or speaker order."""
    updated = dict(options)
    speakers = configured_speakers(options)
    found = False
    for index, item in enumerate(speakers):
        if item["entity_id"] == (original or entry["entity_id"]):
            speakers[index] = entry
            found = True
            break
    if not found:
        speakers.append(entry)
    updated[CONF_SPEAKERS] = speakers
    return updated


def remove_speaker(options: Mapping[str, Any], entity_id: str) -> dict[str, Any]:
    """Remove a speaker without removing any other option."""
    updated = dict(options)
    updated[CONF_SPEAKERS] = [s for s in configured_speakers(options) if s["entity_id"] != entity_id]
    return updated
