const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const TEMP_DIR = path.join(__dirname, "..", "temp");
const YTDLP_PATH = "/usr/local/bin/yt-dlp";

const jobs = new Map();

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function createJob(options) {
    const id = crypto.randomUUID();

    const job = {
        id,
        url: options.url,
        type: options.type,
        extension: options.extension,
        height: options.height,
        bitrate: options.bitrate,

        status: "queued",
        progress: 0,
        speed: null,
        eta: null,

        filename: null,
        filePath: null,
        error: null,

        process: null,
        createdAt: Date.now()
    };

    jobs.set(id, job);

    return job;
}

function getJob(id) {
    return jobs.get(id);
}

function cleanupJobFiles(job) {
    try {
        const files = fs
            .readdirSync(TEMP_DIR)
            .filter((file) => file.startsWith(job.id + "."));

        for (const file of files) {
            try {
                fs.unlinkSync(path.join(TEMP_DIR, file));
            } catch {
                // Ignore individual cleanup errors.
            }
        }
    } catch {
        // Ignore cleanup errors.
    }
}

function startDownload(job) {
    const outputTemplate = path.join(
        TEMP_DIR,
        `${job.id}.%(ext)s`
    );

    let format;

    if (job.type === "video") {
        if (job.extension === "mp4") {
            format =
                `bestvideo[height<=${job.height}][ext=mp4]+bestaudio[ext=m4a]` +
                `/best[height<=${job.height}][ext=mp4]` +
                `/best[height<=${job.height}]`;
        } else {
            format =
                `bestvideo[height<=${job.height}][ext=webm]+bestaudio[ext=webm]` +
                `/best[height<=${job.height}][ext=webm]` +
                `/best[height<=${job.height}]`;
        }
    } else {
        format = "bestaudio/best";
    }

    const args = [
        "--no-playlist",
        "--newline",
        "--progress",
        "--progress-template",
        "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        "-f",
        format,
        "-o",
        outputTemplate
    ];

    if (job.type === "video") {
        args.push(
            "--merge-output-format",
            job.extension
        );
    }

    if (job.type === "audio") {
        args.push(
            "--extract-audio",
            "--audio-format",
            job.extension,
            "--audio-quality",
            `${job.bitrate}K`
        );
    }

    args.push(job.url);

    job.status = "downloading";

    let child;

    try {
        child = spawn(YTDLP_PATH, args, {
            cwd: TEMP_DIR,
            env: process.env
        });
    } catch (error) {
        job.status = "error";
        job.error = `Failed to start yt-dlp: ${error.message}`;
        return;
    }

    job.process = child;

    let stdout = "";
    let stderr = "";
    let spawnError = null;

    child.stdout.on("data", (data) => {
        stdout += data.toString();

        const lines = data
            .toString()
            .split(/\r?\n/);

        for (const line of lines) {
            const match = line.match(
                /^\s*(\d+(?:\.\d+)?)%\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/
            );

            if (!match) {
                continue;
            }

            const percent = Number(match[1]);
            const speed = match[2];
            const eta = match[3];

            if (!Number.isNaN(percent)) {
                job.progress = Math.max(
                    0,
                    Math.min(100, percent)
                );
            }

            if (
                speed &&
                speed !== "Unknown B/s" &&
                speed !== "N/A"
            ) {
                job.speed = speed;
            }

            if (
                eta &&
                eta !== "NA" &&
                eta !== "Unknown"
            ) {
                job.eta = eta;
            }
        }
    });

    child.stderr.on("data", (data) => {
        stderr += data.toString();
    });

    child.on("error", (error) => {
        spawnError = error;

        console.error(
            "yt-dlp spawn error:",
            error
        );

        if (job.status !== "cancelled") {
            job.status = "error";
            job.error =
                `yt-dlp spawn error: ` +
                `${error.code || "unknown"} - ` +
                `${error.message}`;
        }
    });

    child.on("close", (code, signal) => {
        job.process = null;

        if (job.status === "cancelled") {
            cleanupJobFiles(job);
      if (code !== 0) {
    job.status = "error";

    if (stderr.includes("HTTP Error 429")) {
        job.error =
            "YouTube is temporarily rate-limiting the server. Please try again later.";
    } else if (stderr.includes("HTTP Error 403")) {
        job.error =
            "YouTube refused this download request. Please try again later.";
    } else {
        job.error =
            stderr.trim() ||
            stdout.trim() ||
            `yt-dlp exited with code ${code}, signal ${signal || "none"}`;
    }

    console.error(
        "yt-dlp download failed:",
        {
            code,
            signal,
            stderr,
            stdout
        }
    );

    cleanupJobFiles(job);
    return;
}      return;
        }

        if (spawnError) {
            job.status = "error";

            job.error =
                `yt-dlp spawn error: ` +
                `${spawnError.code || "unknown"} - ` +
                `${spawnError.message}`;

            cleanupJobFiles(job);
            return;
        }



        const files = fs
            .readdirSync(TEMP_DIR)
            .filter((file) =>
                file.startsWith(job.id + ".")
            );

        if (files.length === 0) {
            job.status = "error";
            job.error =
                "Download completed but output file was not found.";
            return;
        }

        const preferred = files.find(
            (file) =>
                file.endsWith(`.${job.extension}`)
        );

        const selectedFile =
            preferred || files[0];

        job.filename = selectedFile;
        job.filePath = path.join(
            TEMP_DIR,
            selectedFile
        );

        job.progress = 100;
        job.speed = null;
        job.eta = null;
        job.status = "completed";
    });
}

function cancelJob(id) {
    const job = jobs.get(id);

    if (!job) {
        return false;
    }

    if (
        !job.process ||
        job.status !== "downloading"
    ) {
        return false;
    }

    job.status = "cancelled";
    job.error = null;

    try {
        job.process.kill("SIGTERM");
    } catch {
        // Ignore kill errors.
    }

    setTimeout(() => {
        if (
            job.process &&
            !job.process.killed
        ) {
            try {
                job.process.kill("SIGKILL");
            } catch {
                // Ignore kill errors.
            }
        }
    }, 3000);

    return true;
}

function cleanupJobs() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;

    for (const [id, job] of jobs.entries()) {
        if (
            now - job.createdAt > maxAge &&
            job.status !== "downloading"
        ) {
            cleanupJobFiles(job);
            jobs.delete(id);
        }
    }
}

setInterval(cleanupJobs, 60 * 1000);

module.exports = {
    createJob,
    getJob,
    startDownload,
    cancelJob
};
