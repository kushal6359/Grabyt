const { spawn } = require("child_process");

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            "--dump-single-json",
            "--no-playlist",
            "--no-warnings",
            "--skip-download",
            "--js-runtimes",
            "deno",
            url
        ];

        const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";
        const childProcess = spawn(YTDLP_PATH, args);

        let stdout = "";
        let stderr = "";

        childProcess.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        childProcess.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        childProcess.on("error", (error) => {
            reject(error);
        });

        childProcess.on("close", (code) => {
            if (code !== 0) {
                console.error("yt-dlp metadata error:", stderr);

                reject(
                    new Error(
                        stderr.trim() ||
                        "yt-dlp failed to retrieve video information."
                    )
                );
                return;
            }

            try {
                const info = JSON.parse(stdout);
                resolve(info);
            } catch (error) {
                console.error("Invalid yt-dlp JSON:", error.message);

                reject(
                    new Error("yt-dlp returned invalid metadata.")
                );
            }
        });
    });
}

module.exports = {
    getVideoInfo
};
