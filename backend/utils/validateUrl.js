const ALLOWED_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "www.youtu.be"
]);

function validateYouTubeUrl(input) {
    if (typeof input !== "string" || !input.trim()) {
        return {
            valid: false,
            error: "Please enter a YouTube URL."
        };
    }

    let url;

    try {
        url = new URL(input.trim());
    } catch {
        return {
            valid: false,
            error: "That doesn't look like a valid URL."
        };
    }

    // Only HTTPS YouTube URLs are accepted.
    if (url.protocol !== "https:") {
        return {
            valid: false,
            error: "Only HTTPS YouTube URLs are allowed."
        };
    }

    const hostname = url.hostname.toLowerCase();

    if (!ALLOWED_HOSTS.has(hostname)) {
        return {
            valid: false,
            error: "Please enter a valid YouTube URL."
        };
    }

    // youtu.be/<video-id>
    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
        const videoId = url.pathname.split("/").filter(Boolean)[0];

        if (!videoId) {
            return {
                valid: false,
                error: "The YouTube video ID is missing."
            };
        }

        return {
            valid: true,
            url: `https://youtu.be/${encodeURIComponent(videoId)}`
        };
    }

    // youtube.com/watch?v=<video-id>
    if (url.pathname === "/watch") {
        const videoId = url.searchParams.get("v");

        if (!videoId) {
            return {
                valid: false,
                error: "The YouTube video ID is missing."
            };
        }

        return {
            valid: true,
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        };
    }

    // youtube.com/shorts/<video-id>
    if (url.pathname.startsWith("/shorts/")) {
        const videoId = url.pathname
            .split("/")
            .filter(Boolean)[1];

        if (!videoId) {
            return {
                valid: false,
                error: "The Shorts video ID is missing."
            };
        }

        return {
            valid: true,
            url: `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`
        };
    }

    // youtube.com/embed/<video-id>
    if (url.pathname.startsWith("/embed/")) {
        const videoId = url.pathname
            .split("/")
            .filter(Boolean)[1];

        if (!videoId) {
            return {
                valid: false,
                error: "The YouTube video ID is missing."
            };
        }

        return {
            valid: true,
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        };
    }

    return {
        valid: false,
        error: "Unsupported YouTube URL."
    };
}

module.exports = {
    validateYouTubeUrl
};
