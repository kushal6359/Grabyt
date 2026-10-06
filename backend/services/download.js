const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TEMP_DIR = path.join(__dirname, "..", "temp");

fs.mkdirSync(TEMP_DIR, { recursive: true });

const jobs = new Map();

function createJob(options) {
    const id = crypto.randomUUID();

    const job = {
        id,
        status: "starting",
        progress: 0,
        speed: null,
        eta: null,
        filename: null,
        filePath: null,
        error: null,
        process: null,
        createdAt: Date.now(),
        ...options
    };

    jobs.set(id, job);

    return job;
}

function getJob(id) {
    return jobs.get(id);
}

function startDownload(job) {
    const outputTemplate = path.join(
        TEMP_DIR,
        `${job.id}.%(ext)s`
    );

    /*
     * Use yt-dlp's format selector.
     *
     * MP4:
     * Prefer MP4 video + M4A audio.
     *
     * WebM:
     * Prefer WebM video + Opus audio.
     *
     * The height is limited using job.height.
     */

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
        outputTemplate,
        job.url
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
            job.extension
        );

        if (job.bitrate) {
            args.push(
                "--audio-quality",
                `${job.bitrate}K`
            );
        }
    }

    job.status = "downloading";

    const child = spawn(
        "/data/data/com.termux/files/usr/bin/yt-dlp",
        args
    );

    job.process = child;

    let stderr = "";

    child.stdout.on("data", (data) => {
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
        job.process = null;
        job.status = "error";
        job.error = error.message;
    });

    child.on("close", (code) => {
        job.process = null;

        if (job.status === "cancelled") {
    cleanupJobFiles(job);
    return;
}

        if (code !== 0) {
            job.status = "error";
            job.error = "Download failed.";
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

        /*
         * Prefer the final requested extension.
         */
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
        job.status = "completed";
    });
}
function cleanupJobFiles(job) {
    if (!job || !job.id) {
        return;
    }

    try {
        const files = fs
            .readdirSync(TEMP_DIR)
            .filter((file) =>
                file.startsWith(job.id + ".")
            );

        for (const file of files) {
            try {
                fs.unlinkSync(
                    path.join(TEMP_DIR, file)
                );
            } catch {}
        }
    } catch {}
}
function cancelJob(id) {
    const job = jobs.get(id);

    if (!job || !job.process) {
        return false;
    }

    job.status = "cancelled";

    try {
        job.process.kill("SIGTERM");
    } catch {}

    setTimeout(() => {
        if (job.process) {
            try {
                job.process.kill("SIGKILL");
            } catch {}
        }
    }, 3000);

    return true;
}

function cleanupJobs() {
    const now = Date.now();

    for (const [id, job] of jobs) {
        if (now - job.createdAt > 10 * 60 * 1000) {
    cleanupJobFiles(job);
    jobs.delete(id);
     }
   }
 }

setInterval(
    cleanupJobs,
    60 * 1000
);

module.exports = {
    createJob,
    getJob,
    startDownload,
    cancelJob
};
