"""Constants for P2Talk Google Cast."""

DOMAIN = "p2talk_google_cast"
NAME = "P2Talk Google Cast"
PANEL_PATH = DOMAIN

CONF_SPEAKERS = "speakers"
CONF_AUDIO_BITRATE = "audio_bitrate"
CONF_MAX_RECORD_SECONDS = "max_record_seconds"
CONF_RETENTION_HOURS = "retention_hours"
CONF_DEFAULT_VOLUME = "default_volume"
CONF_FFMPEG_PATH = "ffmpeg_path"

DEFAULTS = {
    CONF_SPEAKERS: [],
    CONF_AUDIO_BITRATE: "64k",  # sufficient for mono speech; reduces LAN and CPU usage
    CONF_MAX_RECORD_SECONDS: 120,
    CONF_RETENTION_HOURS: 2,
    CONF_DEFAULT_VOLUME: 0.65,
    CONF_FFMPEG_PATH: "ffmpeg",
}

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_CHUNK_BYTES = 64 * 1024
MAX_ACTIVE_UPLOADS = 3
UPLOAD_TTL_SECONDS = 300

AUDIO_FORMATS = {
    "audio/webm": "matroska",
    "audio/ogg": "ogg",
    "audio/mp4": "mov",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}
