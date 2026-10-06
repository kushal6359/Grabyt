const express = require("express");

const router = express.Router();

const {
    validateYouTubeUrl
} = require("../utils/validateUrl");

const {
    createJob,
    getJob,
    startDownload,
    cancelJob
} = require("../services/download");

router.post("/", (req, res) => {
    const {
        url,
        type = "video",
        extension = "mp4",
        height = 360,
        bitrate = 192
    } = req.body;

    const normalizedType = String(type).toLowerCase();
    const normalizedExtension = String(extension).toLowerCase();

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

    const allowedExtensions =
        normalizedType === "video"
            ? ["mp4", "webm"]
            : ["mp3", "m4a", "opus"];

    if (!allowedExtensions.includes(normalizedExtension)) {
        return res.status(400).json({
            error: "Invalid file format."
        });
    }

    const allowedHeights = [
        144,
        240,
        360,
        480,
        720,
        1080,
        1440,
        2160
    ];

    const requestedHeight = Number(height);

    if (
        normalizedType === "video" &&
        !allowedHeights.includes(requestedHeight)
    ) {
        return res.status(400).json({
            error: "Invalid video resolution."
        });
    }

    const allowedBitrates = [
        128,
        192,
        320
    ];

    const requestedBitrate = Number(bitrate);

    if (
        normalizedType === "audio" &&
        !allowedBitrates.includes(requestedBitrate)
    ) {
        return res.status(400).json({
            error: "Invalid audio bitrate."
        });
    }

    const job = createJob({
        url: validation.url,
        type: normalizedType,
        extension: normalizedExtension,
        height: requestedHeight,
        bitrate: requestedBitrate
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

    if (
        !require("fs").existsSync(job.filePath)
    ) {
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
