"""On-demand audio transcoding for P2Talk Google Cast.

No disk I/O or process starts during integration setup. Conversion runs only
when an authenticated Home Assistant user finishes a recording.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import shutil
from pathlib import Path
import tempfile
import uuid

from homeassistant.core import HomeAssistant

from .const import (
    AUDIO_FORMATS,
    CONF_AUDIO_BITRATE,
    CONF_FFMPEG_PATH,
    CONF_MAX_RECORD_SECONDS,
    CONF_RETENTION_HOURS,
    DEFAULTS,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


class AudioError(Exception):
    """Safe error to show to the P2Talk frontend."""


def local_media_directory(hass: HomeAssistant) -> Path:
    """Use Home Assistant's configured local media source, not a hardcoded path."""
    directory = hass.config.media_dirs.get("local")
    if not directory:
        raise AudioError(
            "Không có thư mục media local. Hãy cấu hình media_dirs trong Home Assistant."
        )
    return Path(directory) / DOMAIN


def _write_bytes(path: Path, content: bytes) -> None:
    path.write_bytes(content)


def _cleanup(directory: Path, retention_hours: int) -> None:
    if not directory.is_dir():
        return
    cutoff = datetime.now(timezone.utc) - timedelta(hours=retention_hours)
    for file in directory.glob("*.mp3"):
        try:
            if datetime.fromtimestamp(file.stat().st_mtime, timezone.utc) < cutoff:
                file.unlink(missing_ok=True)
        except OSError as err:
            _LOGGER.debug("Cannot clean old recording: %s", err)


async def async_cleanup(hass: HomeAssistant, options: dict) -> None:
    """Sweep only our own recordings without blocking HA's event loop."""
    try:
        directory = local_media_directory(hass)
    except AudioError:
        return
    await hass.async_add_executor_job(
        _cleanup,
        directory,
        options.get(CONF_RETENTION_HOURS, DEFAULTS[CONF_RETENTION_HOURS]),
    )


async def async_convert(
    hass: HomeAssistant, audio: bytes, options: dict, mime_type: str
) -> str:
    """Transcode a browser recording to MP3 without blocking Core's event loop.

    FFmpeg is restricted to a known browser audio container and local I/O.
    """
    input_format = AUDIO_FORMATS.get(mime_type)
    if input_format is None:
        raise AudioError("Định dạng ghi âm không được hỗ trợ.")
    output_dir = local_media_directory(hass)
    await hass.async_add_executor_job(output_dir.mkdir, 0o755, True, True)
    session_id = uuid.uuid4().hex
    output_file = output_dir / f"{session_id}.mp3"
    temp_path = Path(await hass.async_add_executor_job(lambda: tempfile.mkdtemp(prefix="p2talk-")))
    process = None
    success = False
    try:
        source_file = temp_path / "input.audio"
        await hass.async_add_executor_job(_write_bytes, source_file, audio)
        args = [
            str(options.get(CONF_FFMPEG_PATH, DEFAULTS[CONF_FFMPEG_PATH])),
            "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-protocol_whitelist", "file,pipe",
            "-f", input_format, "-i", str(source_file),
            "-vn", "-ac", "1", "-ar", "24000",
            "-b:a", options.get(CONF_AUDIO_BITRATE, DEFAULTS[CONF_AUDIO_BITRATE]),
            "-t", str(options.get(CONF_MAX_RECORD_SECONDS, DEFAULTS[CONF_MAX_RECORD_SECONDS])),
            str(output_file),
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE
            )
        except FileNotFoundError as err:
            raise AudioError("Không tìm thấy FFmpeg trong Home Assistant Core.") from err
        except OSError as err:
            raise AudioError("Không chạy được FFmpeg. Kiểm tra cấu hình đường dẫn.") from err
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=int(options.get(CONF_MAX_RECORD_SECONDS, DEFAULTS[CONF_MAX_RECORD_SECONDS])) + 30,
            )
        except TimeoutError as err:
            raise AudioError("FFmpeg xử lý quá thời gian cho phép.") from err
        if process.returncode != 0:
            _LOGGER.warning("FFmpeg failed: %s", stderr.decode(errors="replace")[-500:])
            raise AudioError("Không chuyển đổi được âm thanh. Kiểm tra codec và FFmpeg.")
        size = await hass.async_add_executor_job(lambda: output_file.stat().st_size if output_file.exists() else 0)
        if size == 0:
            raise AudioError("FFmpeg không tạo được file MP3.")
        success = True
        return f"media-source://media_source/local/{DOMAIN}/{session_id}.mp3"
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.communicate()
        if not success:
            await hass.async_add_executor_job(output_file.unlink, True)
        await hass.async_add_executor_job(shutil.rmtree, temp_path, True)
