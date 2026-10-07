const fs = require("fs");
const path = require("path");

/* Delete files in dir older than maxAgeMs (0 = everything). */
function sweep(dir, maxAgeMs) {
    let files;

    try {
        files = fs.readdirSync(dir);
    } catch {
        return;
    }

    const now = Date.now();

    for (const file of files) {
        const full = path.join(dir, file);

        try {
            const stat = fs.statSync(full);

            if (stat.isFile() && now - stat.mtimeMs >= maxAgeMs) {
                fs.unlinkSync(full);
            }
        } catch {
            // Ignore files that vanish mid-sweep.
        }
    }
}

/* Wipe leftovers from a previous run, then sweep orphans periodically. */
function startCleanup(dir, maxAgeMs = 30 * 60 * 1000) {
    sweep(dir, 0);

    const timer = setInterval(() => sweep(dir, maxAgeMs), 5 * 60 * 1000);
    timer.unref();
}

module.exports = { startCleanup };
