const { spawn } = require("child_process");

const {
    YTDLP_PATH,
    PROFILES,
    baseArgs,
    classifyError,
    hasCookies
} = require("./ytdlpArgs");

function runJson(url, profile) {
    return new Promise((resolve, reject) => {
        const args = baseArgs(profile).concat([
            "--dump-single-json",
            "--skip-download",
            "--no-warnings",
            url
        ]);

        const child = spawn(YTDLP_PATH, args);

        let stdout = "";
        let stderr = "";

        const timer = setTimeout(() => {
            child.kill("SIGKILL");
        }, 60 * 1000);

        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));

        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on("close", (code) => {
            clearTimeout(timer);

            if (code !== 0) {
                const err = new Error(stderr.trim() || "yt-dlp failed.");
                err.classified = classifyError(stderr);
                err.stderr = stderr;
                reject(err);
                return;
            }

            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error("yt-dlp returned invalid metadata."));
            }
        });
    });
}

/* Try yt-dlp's default client, then fall back to other clients. */
async function getVideoInfo(url) {
    let lastError;

    for (const profile of PROFILES) {
        try {
            const info = await runJson(url, profile);

            // A response with no real video formats is as good as a failure.
            const usable = (info.formats || []).some(
                (f) => f.vcodec && f.vcodec !== "none" && f.height
            );

            if (usable) {
                return info;
            }

            lastError = new Error("No usable formats returned.");
            lastError.classified = classifyError("only images are available");
        } catch (error) {
            lastError = error;
            console.error(
                `yt-dlp metadata failed (${profile.name}):`,
                (error.stderr || error.message).slice(0, 600)
            );

            if (error.code === "ENOENT") {
                throw error;
            }

            if (error.classified && !error.classified.retry) {
                throw error;
            }
        }
    }

    throw lastError;
}

let versionCache = { value: null, at: 0 };

function getYtDlpVersion() {
    return new Promise((resolve) => {
        if (Date.now() - versionCache.at < 60 * 1000) {
            return resolve(versionCache.value);
        }

        let out = "";
        let child;

        try {
            child = spawn(YTDLP_PATH, ["--version"]);
        } catch {
            return resolve(null);
        }

        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);

        child.stdout.on("data", (d) => (out += d.toString()));
        child.on("error", () => {
            clearTimeout(timer);
            resolve(null);
        });
        child.on("close", () => {
            clearTimeout(timer);
            versionCache = { value: out.trim() || null, at: Date.now() };
            resolve(versionCache.value);
        });
    });
}

/* YouTube breaks yt-dlp regularly; refresh it in the background on boot. */
function updateYtDlp() {
    const child = spawn(
        "python3",
        [
            "-m", "pip", "install", "-U", "--pre",
            "--break-system-packages", "yt-dlp[default]"
        ],
        { stdio: "ignore" }
    );

    child.on("error", () => {});
    child.on("close", (code) => {
        versionCache = { value: null, at: 0 };
        console.log(`yt-dlp auto-update finished (exit ${code}).`);
    });
}

module.exports = {
    getVideoInfo,
    getYtDlpVersion,
    updateYtDlp,
    hasCookies
};
