const fs = require("fs");
const express = require("express");

const router = express.Router();

const {
    validateYouTubeUrl
} = require("../utils/validateUrl");

const {
    createJob,
    getJob,
    startDownload,
    cancelJob,
    hasCapacity
} = require("../services/download");

const ALLOWED_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160];
const ALLOWED_BITRATES = [128, 192, 320];

// Real videos report odd heights (e.g. 1038, 608, or 1920 for a vertical
// Short). Use the smallest supported cap that still includes that height,
// so the chosen stream always fits under the cap.
function snapHeight(value) {
    const n = Number(value);

    if (!Number.isFinite(n) || n < 100 || n > 4400) {
        return null;
    }

    const fits = ALLOWED_HEIGHTS.find((h) => h >= n);

    return fits || ALLOWED_HEIGHTS[ALLOWED_HEIGHTS.length - 1];
}

// Source audio reports its real bitrate (e.g. 129.5). Snap to the nearest.
function snapBitrate(value) {
    const n = Number(value);

    if (!Number.isFinite(n) || n <= 0) {
        return 192;
    }

    return ALLOWED_BITRATES.reduce((best, b) =>
        Math.abs(b - n) < Math.abs(best - n) ? b : best
    );
}

router.post("/", (req, res) => {
    const {
        url,
        type = "video",
        extension = "mp4",
        height = 360,
        bitrate = 192
    } = req.body || {};

    const normalizedType = String(type).toLowerCase();
    let normalizedExtension = String(extension).toLowerCase();

    const validation = validateYouTubeUrl(url);

    if (!validation.valid) {
        return res.status(400).json({
            error: validation.error
        });
    }

    if (!["video", "audio"].includes(normalizedType)) {
        return res.status(400).json({
            error: "Invalid download type."
        });
    }

    // YouTube's best audio streams are reported as "webm"; that is Opus.
    if (normalizedType === "audio" && normalizedExtension === "webm") {
        normalizedExtension = "opus";
    }

    const allowedExtensions =
        normalizedType === "video"
            ? ["mp4", "webm"]
            : ["mp3", "m4a", "opus"];

    if (!allowedExtensions.includes(normalizedExtension)) {
        return res.status(400).json({
            error: "Invalid file format."
        });
    }

    let requestedHeight = 360;

    if (normalizedType === "video") {
        requestedHeight = snapHeight(height);

        if (!requestedHeight) {
            return res.status(400).json({
                error: "Invalid video resolution."
            });
        }
    }

    if (!hasCapacity()) {
        return res.status(429).json({
            error:
                "The server is busy with other downloads. " +
                "Please try again in a minute."
        });
    }

    const job = createJob({
        url: validation.url,
        type: normalizedType,
        extension: normalizedExtension,
        height: requestedHeight,
        bitrate: snapBitrate(bitrate)
    });

    startDownload(job);

    res.status(202).json({
        success: true,
        jobId: job.id
    });
});

router.get("/:id", (req, res) => {
    const job = getJob(req.params.id);

    if (!job) {
        return res.status(404).json({
            error: "Download job not found."
        });
    }

    res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        speed: job.speed,
        eta: job.eta,
        filename: job.filename,
        error: job.error
    });
});

router.post("/:id/cancel", (req, res) => {
    const cancelled = cancelJob(req.params.id);

    if (!cancelled) {
        return res.status(400).json({
            error: "Download cannot be cancelled."
        });
    }

    res.json({
        success: true,
        status: "cancelled"
    });
});

router.get("/:id/file", (req, res) => {
    const job = getJob(req.params.id);

    if (!job) {
        return res.status(404).json({
            error: "Download job not found."
        });
    }

    if (job.status !== "completed" || !job.filePath) {
        return res.status(409).json({
            error: "The download is not ready yet."
        });
    }

    if (!fs.existsSync(job.filePath)) {
        return res.status(404).json({
            error: "Output file not found."
        });
    }

    res.download(
        job.filePath,
        job.filename
    );
});

module.exports = router;
