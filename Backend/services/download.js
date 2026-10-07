const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const {
    YTDLP_PATH,
    PROFILES,
    baseArgs,
    classifyError
} = require("./ytdlpArgs");

const { startCleanup } = require("../utils/cleanup");

const TEMP_DIR =
    process.env.TEMP_DIR || path.join(__dirname, "..", "temp");

const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_DOWNLOADS || 2);
const JOB_TIMEOUT_MS = Number(
    process.env.DOWNLOAD_TIMEOUT_MS || 20 * 60 * 1000
);
const JOB_KEEP_MS = 30 * 60 * 1000;

const jobs = new Map();

fs.mkdirSync(TEMP_DIR, { recursive: true });
startCleanup(TEMP_DIR);

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
        timeout: null,
        timedOut: false,
        createdAt: Date.now()
    };

    jobs.set(id, job);

    return job;
}

function getJob(id) {
    return jobs.get(id);
}

function activeCount() {
    let count = 0;

    for (const job of jobs.values()) {
        if (job.status === "downloading") {
            count++;
        }
    }

    return count;
}

function hasCapacity() {
    return activeCount() < MAX_ACTIVE;
}

function jobFiles(job) {
    try {
        return fs
            .readdirSync(TEMP_DIR)
            .filter((file) => file.startsWith(job.id + "."));
    } catch {
        return [];
    }
}

function cleanupJobFiles(job) {
    for (const file of jobFiles(job)) {
        try {
            fs.unlinkSync(path.join(TEMP_DIR, file));
        } catch {
            // Ignore individual cleanup errors.
        }
    }
}

function buildFormat(job) {
    const h = job.height;

    if (job.type === "audio") {
        return "ba/b";
    }

    if (job.extension === "mp4") {
        // Prefer H.264 + AAC (plays everywhere), then any mp4, then
        // whatever YouTube has at that height, then a single file.
        return (
            `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]` +
            `/bv*[height<=${h}][ext=mp4]+ba[ext=m4a]` +
            `/bv*[height<=${h}]+ba` +
            `/b[height<=${h}]` +
            `/b`
        );
    }

    return (
        `bv*[height<=${h}][ext=webm]+ba[ext=webm]` +
        `/bv*[height<=${h}]+ba` +
        `/b[height<=${h}]` +
        `/b`
    );
}

function sanitizeName(name) {
    const cleaned = String(name || "")
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100)
        .trim();

    return cleaned || "grab-download";
}

function readTitle(job) {
    const infoPath = path.join(TEMP_DIR, `${job.id}.info.json`);

    try {
        const data = JSON.parse(fs.readFileSync(infoPath, "utf8"));
        return data.title || null;
    } catch {
        return null;
    }
}

function finalizeJob(job) {
    const files = jobFiles(job).filter(
        (file) =>
            !/\.(part|ytdl|json|temp)$/i.test(file) &&
            !/\.f\d+\./.test(file)
    );

    if (files.length === 0) {
        job.status = "error";
        job.error = "Download completed but output file was not found.";
        cleanupJobFiles(job);
        return;
    }

    const preferred = files.find((file) =>
        file.toLowerCase().endsWith(`.${job.extension}`)
    );

    let selected = preferred;

    if (!selected) {
        // Pick the biggest file (the real media, not a leftover).
        selected = files
            .map((file) => ({
                file,
                size: fs.statSync(path.join(TEMP_DIR, file)).size
            }))
            .sort((a, b) => b.size - a.size)[0].file;
    }

    const ext = path.extname(selected);
    const title = readTitle(job);

    try {
        fs.unlinkSync(path.join(TEMP_DIR, `${job.id}.info.json`));
    } catch {
        // Not important.
    }

    job.filePath = path.join(TEMP_DIR, selected);
    job.filename = `${sanitizeName(title)}${ext}`;
    job.progress = 100;
    job.speed = null;
    job.eta = null;
    job.status = "completed";
}

function failJob(job, message) {
    job.status = "error";
    job.error = message;
    cleanupJobFiles(job);
}

function runAttempt(job, index) {
    if (job.status === "cancelled") {
        cleanupJobFiles(job);
        return;
    }

    const profile = PROFILES[index];

    const args = baseArgs(profile).concat([
        "--newline",
        "--progress",
        "--progress-template",
        "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        "--write-info-json",
        "-f",
        buildFormat(job),
        "-o",
        path.join(TEMP_DIR, `${job.id}.%(ext)s`)
    ]);

    if (job.type === "video") {
        args.push("--merge-output-format", `${job.extension}/mkv`);
    } else {
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
    job.progress = 0;
    job.speed = null;
    job.eta = null;

    let child;

    try {
        child = spawn(YTDLP_PATH, args, { cwd: TEMP_DIR, env: process.env });
    } catch (error) {
        failJob(job, `Failed to start yt-dlp: ${error.message}`);
        return;
    }

    job.process = child;

    let stderr = "";
    let tail = "";
    let spawnError = null;
    let streams = job.type === "video" ? 2 : 1;
    let streamIndex = 0;

    function handleLine(line) {
        const formats = line.match(/Downloading \d+ format\(s\):\s*(\S+)/);

        if (formats) {
            streams = Math.max(1, formats[1].split("+").length);
            return;
        }

        if (/^\[download\] Destination:/.test(line)) {
            streamIndex++;
            return;
        }

        const match = line.match(
            /^\s*(\d+(?:\.\d+)?)%\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/
        );

        if (!match) {
            return;
        }

        const percent = Math.max(0, Math.min(100, Number(match[1])));
        const done = Math.max(0, streamIndex - 1);
        const overall = ((done * 100 + percent) / streams);

        // Never let the bar go backwards.
        job.progress = Math.max(job.progress, Math.min(99, overall));

        const speed = match[2];
        const eta = match[3];

        if (speed && !/unknown|n\/a/i.test(speed)) {
            job.speed = speed;
        }

        if (eta && !/^(na|unknown|n\/a)$/i.test(eta)) {
            job.eta = eta;
        }
    }

    child.stdout.on("data", (data) => {
        tail += data.toString();
        const lines = tail.split(/\r?\n/);
        tail = lines.pop();
        lines.forEach(handleLine);
    });

    child.stderr.on("data", (data) => {
        stderr += data.toString();
    });

    child.on("error", (error) => {
        spawnError = error;
    });

    child.on("close", (code, signal) => {
        job.process = null;

        if (tail) {
            handleLine(tail);
        }

        if (job.status === "cancelled") {
            clearTimeout(job.timeout);
            cleanupJobFiles(job);
            return;
        }

        if (spawnError) {
            clearTimeout(job.timeout);
            failJob(
                job,
                spawnError.code === "ENOENT"
                    ? "yt-dlp is not installed on the server."
                    : `yt-dlp could not start: ${spawnError.message}`
            );
            return;
        }

        if (job.timedOut) {
            failJob(job, "The download took too long and was stopped.");
            return;
        }

        if (code === 0) {
            clearTimeout(job.timeout);
            finalizeJob(job);
            return;
        }

        const classified = classifyError(stderr);

        console.error(
            `yt-dlp download failed (${profile.name}, exit ${code}, ${signal || "no signal"}):`,
            stderr.slice(-800)
        );

        if (classified.retry && index + 1 < PROFILES.length) {
            cleanupJobFiles(job);
            runAttempt(job, index + 1);
            return;
        }

        clearTimeout(job.timeout);
        failJob(job, classified.message);
    });
}

function startDownload(job) {
    job.status = "downloading";

    job.timeout = setTimeout(() => {
        job.timedOut = true;

        if (job.process) {
            try {
                job.process.kill("SIGKILL");
            } catch {
                // Ignore kill errors.
            }
        }
    }, JOB_TIMEOUT_MS);

    runAttempt(job, 0);
}

function cancelJob(id) {
    const job = jobs.get(id);

    if (!job || job.status !== "downloading") {
        return false;
    }

    job.status = "cancelled";
    job.error = null;
    clearTimeout(job.timeout);

    const child = job.process;

    if (child) {
        try {
            child.kill("SIGTERM");
        } catch {
            // Ignore kill errors.
        }

        setTimeout(() => {
            try {
                child.kill("SIGKILL");
            } catch {
                // Already gone.
            }
        }, 3000).unref();
    }

    return true;
}

function cleanupJobs() {
    const now = Date.now();

    for (const [id, job] of jobs.entries()) {
        if (
            now - job.createdAt > JOB_KEEP_MS &&
            job.status !== "downloading"
        ) {
            cleanupJobFiles(job);
            jobs.delete(id);
        }
    }
}

setInterval(cleanupJobs, 60 * 1000).unref();

module.exports = {
    createJob,
    getJob,
    startDownload,
    cancelJob,
    hasCapacity,
    activeCount
};
