const { spawn } = require("child_process");

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = [
            "--dump-single-json",
            "--no-playlist",
            "--no-warnings",
            "--skip-download",
            url
        ];

        const process = spawn("yt-dlp", args);

        let stdout = "";
        let stderr = "";

        process.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        process.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        process.on("error", (error) => {
            reject(error);
        });

        process.on("close", (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        stderr.trim() || "yt-dlp failed to retrieve video information."
                    )
                );
                return;
            }

            try {
                const info = JSON.parse(stdout);
                resolve(info);
            } catch {
                reject(new Error("yt-dlp returned invalid metadata."));
            }
        });
    });
}

module.exports = {
    getVideoInfo
};
