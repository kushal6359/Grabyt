const fs = require("fs");
const os = require("os");
const path = require("path");

const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";

/*
 * Optional YouTube cookies (see README). Supply ONE of:
 *   YTDLP_COOKIES_B64   base64 of a Netscape-format cookies.txt
 *   YTDLP_COOKIES_FILE  path to a cookies.txt inside the container
 * A private copy is written to the OS temp dir because yt-dlp rewrites it.
 */
let cookiesPath;

function getCookiesPath() {
    if (cookiesPath !== undefined) {
        return cookiesPath;
    }

    cookiesPath = null;

    try {
        const target = path.join(os.tmpdir(), "grab-cookies.txt");

        if (process.env.YTDLP_COOKIES_B64) {
            fs.writeFileSync(
                target,
                Buffer.from(process.env.YTDLP_COOKIES_B64, "base64"),
                { mode: 0o600 }
            );
            cookiesPath = target;
        } else if (
            process.env.YTDLP_COOKIES_FILE &&
            fs.existsSync(process.env.YTDLP_COOKIES_FILE)
        ) {
            fs.copyFileSync(process.env.YTDLP_COOKIES_FILE, target);
            fs.chmodSync(target, 0o600);
            cookiesPath = target;
        }
    } catch (error) {
        console.error("Could not prepare cookies:", error.message);
    }

    return cookiesPath;
}

/*
 * YouTube changes its player often. Instead of forcing one client (which
 * breaks the moment that client needs a PO token), try yt-dlp's own
 * default first and fall back to other clients only if it fails.
 * Set YTDLP_PLAYER_CLIENT to pin a single client list, e.g. "tv,web_safari".
 */
const PROFILES = process.env.YTDLP_PLAYER_CLIENT
    ? [
        {
            name: process.env.YTDLP_PLAYER_CLIENT,
            args: [
                "--extractor-args",
                `youtube:player_client=${process.env.YTDLP_PLAYER_CLIENT}`
            ]
        }
    ]
    : [
        { name: "default", args: [] },
        {
            name: "tv,web_safari",
            args: [
                "--extractor-args",
                "youtube:player_client=tv,web_safari"
            ]
        },
        {
            name: "android_vr",
            args: [
                "--extractor-args",
                "youtube:player_client=android_vr"
            ]
        }
    ];

function baseArgs(profile) {
    const args = [
        "--no-playlist",
        "--no-colors",
        "--socket-timeout", "20",
        "--retries", "5",
        "--fragment-retries", "5",
        // YouTube's player code needs a JS runtime; deno is installed in
        // the Docker image and node is always there as a backup.
        "--js-runtimes", "deno",
        "--js-runtimes", "node"
    ];

    const cookies = getCookiesPath();
    if (cookies) {
        args.push("--cookies", cookies);
    }

    if (process.env.YTDLP_PROXY) {
        args.push("--proxy", process.env.YTDLP_PROXY);
    }

    return args.concat(profile ? profile.args : []);
}

/* Turn raw yt-dlp stderr into something a person can act on. */
function classifyError(stderr) {
    const text = String(stderr || "");

    if (/confirm you.?re not a bot|sign in to confirm/i.test(text)) {
        return {
            kind: "bot",
            retry: true,
            message:
                "YouTube is asking this server to prove it isn't a bot. " +
                "This is common on cloud hosts. Add YouTube cookies on the " +
                "server, or run the backend from your own computer."
        };
    }

    if (/HTTP Error 429|too many requests/i.test(text)) {
        return {
            kind: "ratelimit",
            retry: true,
            message:
                "YouTube is temporarily rate-limiting the server. " +
                "Please try again later."
        };
    }

    if (/HTTP Error 403|forbidden/i.test(text)) {
        return {
            kind: "forbidden",
            retry: true,
            message:
                "YouTube refused this download request. Please try again later."
        };
    }

    if (
        /requested format is not available|n challenge|nsig|signature extraction|unable to extract|only images are available/i.test(
            text
        )
    ) {
        return {
            kind: "format",
            retry: true,
            message:
                "YouTube didn't give the server a usable stream for that quality. " +
                "Try a different quality or try again shortly."
        };
    }

    if (/private video/i.test(text)) {
        return { kind: "private", retry: false, message: "This video is private." };
    }

    if (/age.?restricted|confirm your age|inappropriate for some users/i.test(text)) {
        return {
            kind: "age",
            retry: false,
            message: "This video is age-restricted and needs a signed-in account (cookies)."
        };
    }

    if (/video unavailable|has been removed|not available in your country|blocked it/i.test(text)) {
        return {
            kind: "unavailable",
            retry: false,
            message: "This video is unavailable or blocked for the server's region."
        };
    }

    if (/premieres in|live event will begin|is live/i.test(text)) {
        return {
            kind: "live",
            retry: false,
            message: "Live streams and upcoming premieres can't be downloaded yet."
        };
    }

    if (/ffmpeg/i.test(text) && /not found|not installed/i.test(text)) {
        return {
            kind: "ffmpeg",
            retry: false,
            message: "ffmpeg is missing on the server."
        };
    }

    return {
        kind: "other",
        retry: true,
        message: "The download failed. Please try again."
    };
}

module.exports = {
    YTDLP_PATH,
    PROFILES,
    baseArgs,
    classifyError,
    hasCookies: () => Boolean(getCookiesPath())
};
