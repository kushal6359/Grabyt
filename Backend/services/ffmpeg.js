const { spawnSync } = require("child_process");

function hasFfmpeg() {
    try {
        const result = spawnSync("ffmpeg", ["-version"], {
            timeout: 5000
        });
        return result.status === 0;
    } catch {
        return false;
    }
}

module.exports = { hasFfmpeg };
