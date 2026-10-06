const downloadRouter =
    require("./routes/download");
const infoRouter = require("./routes/info");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet());

// Parse JSON requests
app.use(express.json({ limit: "10kb" }));

// Allow frontend requests
app.use(cors());

// Basic API rate limiting
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many requests. Please try again later."
    }
});

app.use("/api", apiLimiter);
app.use("/api/info", infoRouter);
app.use(
    "/api/download",
    downloadRouter
);
// Health-check endpoint
app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        service: "Grab backend",
        status: "running"
    });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grab backend running on port ${PORT}`);
});
