const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const downloadRouter = require("./routes/download");
const infoRouter = require("./routes/info");
const { getYtDlpVersion, updateYtDlp, hasCookies } = require("./services/ytdlp");
const { hasFfmpeg } = require("./services/ffmpeg");
const { activeCount } = require("./services/download");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// Security headers. This server only returns JSON and media files, and the
// frontend is often hosted on a different origin, so media must be allowed
// to load cross-origin (otherwise the in-page player is blocked).
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    })
);

app.use(cors({ exposedHeaders: ["Content-Disposition", "Content-Length"] }));
app.use(express.json({ limit: "10kb" }));

// Limit the expensive calls (metadata lookup / starting a download).
// Status polling (GET, once a second while downloading) must NOT count,
// or a single download would hit the limit and fail half-way.
const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== "POST" || req.path.endsWith("/cancel"),
    message: { error: "Too many requests. Please try again later." }
});

const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "POST",
    message: { error: "Too many requests. Please try again later." }
});

app.use("/api", writeLimiter, readLimiter);

app.use("/api/info", infoRouter);
app.use("/api/download", downloadRouter);

app.get("/api/health", async (req, res) => {
    const version = await getYtDlpVersion();

    res.json({
        ok: true,
        service: "Grab backend",
        status: "running",
        ytdlp: version,
        ffmpeg: hasFfmpeg(),
        cookies: hasCookies(),
        activeDownloads: activeCount()
    });
});

// Optional: serve the frontend from this server too (handy for running
// locally: open http://localhost:3000). Only these two files are exposed.
const FRONTEND_DIRS = [
    path.join(__dirname, "public"),
    path.join(__dirname, "..")
];

function frontendFile(name) {
    for (const dir of FRONTEND_DIRS) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) {
            return full;
        }
    }
    return null;
}

for (const [route, file] of [
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/Logo.png", "Logo.png"]
]) {
    app.get(route, (req, res, next) => {
        const full = frontendFile(file);
        return full ? res.sendFile(full) : next();
    });
}

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grab backend running on port ${PORT}`);

    if (process.env.AUTO_UPDATE_YTDLP === "1") {
        updateYtDlp();
    }
});
