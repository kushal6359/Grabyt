const express = require("express");

const router = express.Router();

const { validateYouTubeUrl } = require("../utils/validateUrl");
const { getVideoInfo } = require("../services/ytdlp");

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) {
        return null;
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}
function getFormats(info) {
    const formats = Array.isArray(info.formats)
        ? info.formats
        : [];

    const resolutionMap = new Map();

    // Only expose resolutions that yt-dlp actually found.
    for (const format of formats) {
        const hasVideo =
            format.vcodec &&
            format.vcodec !== "none";

        if (!hasVideo || !format.height) {
            continue;
        }

        const height = Number(format.height);

        // Grab supports 144p through 4K.
        if (height < 144 || height > 2160) {
            continue;
        }

        const extension = format.ext;

        if (!["mp4", "webm"].includes(extension)) {
            continue;
        }

        const size =
            format.filesize ||
            format.filesize_approx ||
            null;

        const existing = resolutionMap.get(height);

        // Prefer MP4 when both MP4 and WebM are available.
        if (
            !existing ||
            (extension === "mp4" && existing.extension !== "mp4")
        ) {
            resolutionMap.set(height, {
                formatId: format.format_id,
                resolution: `${height}p`,
                height,
                extension,
                size,
                sizeFormatted: formatBytes(size),
                videoCodec: format.vcodec,
                fps: format.fps || null
            });
        }
    }

    const video = Array.from(resolutionMap.values())
        .sort((a, b) => b.height - a.height);

    /*
     * Audio is handled separately.
     * We collect the highest-quality formats yt-dlp reports.
     */
    const audioMap = new Map();

    for (const format of formats) {
        const hasAudio =
            format.acodec &&
            format.acodec !== "none";

        const hasVideo =
            format.vcodec &&
            format.vcodec !== "none";

        if (!hasAudio || hasVideo) {
            continue;
        }

        const bitrate = Number(format.abr || 0);

        if (!bitrate) {
            continue;
        }

        const extension = format.ext;

        if (!["m4a", "webm", "opus"].includes(extension)) {
            continue;
        }

        const key = extension;

        const existing = audioMap.get(key);

        if (!existing || bitrate > existing.bitrate) {
            audioMap.set(key, {
                formatId: format.format_id,
                extension,
                bitrate,
                size: format.filesize ||
                    format.filesize_approx ||
                    null,
                sizeFormatted: formatBytes(
                    format.filesize ||
                    format.filesize_approx
                ),
                codec: format.acodec
            });
        }
    }

    const audio = Array.from(audioMap.values())
        .sort((a, b) => b.bitrate - a.bitrate);

    return {
        video,
        audio
    };
}

router.post("/", async (req, res) => {
    const { url } = req.body;

    const validation = validateYouTubeUrl(url);

    if (!validation.valid) {
        return res.status(400).json({
            error: validation.error
        });
    }

    try {
        const info = await getVideoInfo(validation.url);

        const formats = getFormats(info);

        res.json({
            success: true,

            video: {
                id: info.id,
                title: info.title,
                channel: info.channel || info.uploader || "Unknown",
                duration: info.duration || null,
                thumbnail: info.thumbnail || null,
                webpageUrl: info.webpage_url
            },

            formats
        });

    } catch (error) {
        console.error("Metadata error:", error.message);

        res.status(500).json({
            error: "Unable to retrieve information for this video."
        });
    }
});

module.exports = router;
