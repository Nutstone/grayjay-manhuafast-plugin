const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;
const REGEX_HUMAN_AGO = new RegExp("([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago");
const REGEX_CHANNEL_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+)\/$");
const REGEX_CONTENT_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+(?:\/[^\/]+)+)\/$");

const config = {};

function asString(v) {
    return (v === null || v === undefined) ? "" : String(v);
}

function previewBody(body, max = 250) {
    body = asString(body).replace(/\s+/g, " ").trim();
    return body.length > max ? body.slice(0, max) + "..." : body;
}

function isLikelyCloudflare(html) {
    html = asString(html);
    return (
        html.includes("cf-browser-verification") ||
        html.includes("challenge-platform") ||
        html.includes("cf_chl_") ||
        html.includes("Just a moment") ||
        html.includes("/cdn-cgi/")
    );
}

function httpGetOrThrow(url, headers = {}) {
    let res;
    try {
        res = http.GET(url, headers, false);
    } catch (e) {
        throw new ScriptException("HttpError", `GET failed: ${url}\n${asString(e)}`);
    }

    const body = asString(res?.body);
    const code = res?.code ?? res?.status ?? 0;

    if (code && code >= 400) {
        throw new ScriptException("HttpError", `GET ${url} returned HTTP ${code}\n${previewBody(body)}`);
    }
    if (!body || body.length < 50) {
        throw new ScriptException("HttpError", `GET ${url} returned an empty/short body.\n${previewBody(body)}`);
    }
    if (isLikelyCloudflare(body)) {
        throw new ScriptException(
            "Cloudflare",
            `Cloudflare challenge received for:\n${url}\n` +
            `Grayjay plugins can't solve CF challenges. Use browser/open-web or an unprotected endpoint.`
        );
    }

    return body;
}

function httpPostOrThrow(url, bodyStr = "", headers = {}) {
    let res;
    try {
        res = http.POST(url, bodyStr, headers, false);
    } catch (e) {
        throw new ScriptException("HttpError", `POST failed: ${url}\n${asString(e)}`);
    }

    const body = asString(res?.body);
    const code = res?.code ?? res?.status ?? 0;

    if (code && code >= 400) {
        throw new ScriptException("HttpError", `POST ${url} returned HTTP ${code}\n${previewBody(body)}`);
    }
    if (!body || body.length < 50) {
        throw new ScriptException("HttpError", `POST ${url} returned an empty/short body.\n${previewBody(body)}`);
    }
    if (isLikelyCloudflare(body)) {
        throw new ScriptException("Cloudflare", `Cloudflare challenge received for:\n${url}`);
    }

    return body;
}

function parseHtmlOrThrow(url, html) {
    try {
        return domParser.parseFromString(html, "text/html");
    } catch (e) {
        throw new ScriptException("ParseError", `DOM parse failed for ${url}\n${asString(e)}\n${previewBody(html)}`);
    }
}

function q(node, selector) {
    return node ? node.querySelector(selector) : null;
}

function qAll(node, selector) {
    return node ? node.querySelectorAll(selector) : [];
}

function text(el) {
    return asString(el?.textContent).trim();
}

function attr(el, name) {
    return asString(el?.getAttribute?.(name)).trim();
}

function requireEl(el, what, url, selectorHint = "") {
    if (el) return el;
    const hint = selectorHint ? ` (selector: ${selectorHint})` : "";
    throw new ScriptException("ParseError", `Missing ${what}${hint} on ${url}`);
}

// --------------------
// Your existing logic (safer)
// --------------------
source.enable = function (conf) {
    this.config = conf;
    console.log("WP Manga plugin enabled with config: ", conf);
};

function extract_Timestamp(str) {
    str = asString(str).trim();
    if (!str) return 0;

    const match = str.match(REGEX_HUMAN_AGO);
    if (match) {
        const value = parseInt(match[1]);
        const now = Math.floor(new Date().getTime() / 1000);

        switch (match[2]) {
            case "second":
            case "seconds":
                return now - value;
            case "min":
            case "mins":
                return now - value * 60;
            case "hour":
            case "hours":
                return now - value * 60 * 60;
            case "day":
            case "days":
                return now - value * 60 * 60 * 24;
            case "week":
            case "weeks":
                return now - value * 60 * 60 * 24 * 7;
            case "month":
            case "months":
                return now - value * 60 * 60 * 24 * 30; // approx
            case "year":
            case "years":
                return now - value * 60 * 60 * 24 * 365; // approx
            default:
                // Don't throw (avoid breaking on new units)
                return 0;
        }
    }

    const date = new Date(str);
    if (!isNaN(date.getTime())) return Math.floor(date.getTime() / 1000);

    return 0;
}

source.getHome = function (continuationToken) {
    const homeUrl = "https://manhuafast.com/";
    const html = httpGetOrThrow(homeUrl);
    const doc = parseHtmlOrThrow(homeUrl, html);

    const mangaItems = [];
    const cards = qAll(doc, ".page-item-detail");

    for (const item of cards) {
        try {
            const mangaAnchor = requireEl(q(item, ".post-title a"), "manga link", homeUrl, ".post-title a");
            const chapterAnchor = requireEl(q(item, ".chapter-item .chapter a"), "chapter link", homeUrl, ".chapter-item .chapter a");

            const mangaTitle = text(mangaAnchor);
            const mangaLink = attr(mangaAnchor, "href");
            const mangaId = mangaLink.split("/manga/")[1] || mangaLink;

            const mangaChapter = text(chapterAnchor);
            const mangaChapterLink = attr(chapterAnchor, "href");

            const mangaPostedTime = extract_Timestamp(text(q(item, ".post-on")));

            const img = q(item, "img");
            const mangaThumbnail = attr(img, "data-src") || attr(img, "src");

            const id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);
            const author = new PlatformAuthorLink(id, mangaTitle, mangaLink, mangaThumbnail, 0, "");

            const manga = {
                id: id,
                author: author,
                name: mangaChapter,
                datetime: mangaPostedTime,
                thumbnails: [],
                description: "",
                url: mangaChapterLink,
                images: [],
                contentUrl: mangaChapterLink,
                contentName: mangaChapter,
                contentDescription: "",
                contentProvider: author
            };

            mangaItems.push(new PlatformNestedMediaContent(manga));
        } catch (e) {
            console.log("Skipped home item due to parse error: " + asString(e));
        }
    }

    return new ContentPager(mangaItems, false, { continuationToken });
};

source.searchSuggestions = function (query) {
    return [];
};

source.getSearchCapabilities = function () {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological, "^release_time"],
        filters: []
    };
};

source.search = function (query, type, order, filters, continuationToken) {
    return [];
};

source.searchChannels = function (query, continuationToken) {
    const searchUrl = "https://manhuafast.com/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
    const html = httpGetOrThrow(searchUrl);
    const doc = parseHtmlOrThrow(searchUrl, html);

    const channels = [];
    for (const item of qAll(doc, ".post-title a")) {
        try {
            const href = attr(item, "href");
            const mangaIdPart = href.split("/manga/")[1] || href;

            const mangaId = new PlatformID(PLATFORM, mangaIdPart, config.id, PLATFORM_CLAIMTYPE);
            const mangaName = text(item);

            const channel = {
                id: mangaId,
                name: mangaName,
                thumbnail: "",
                banner: "",
                subscibers: 0,
                description: "",
                url: href,
                urlAlternatives: [],
                links: {}
            };

            channels.push(new PlatformChannel(channel));
        } catch (e) {
            console.log("Skipped channel search item due to parse error: " + asString(e));
        }
    }

    return new ChannelPager(channels, false, { query, continuationToken });
};

source.isChannelUrl = function (url) {
    return REGEX_CHANNEL_URL.test(url);
};

source.getChannel = function (url) {
    const html = httpGetOrThrow(url);
    const doc = parseHtmlOrThrow(url, html);

    const h1 = requireEl(q(doc, "h1"), "channel title (h1)", url, "h1");
    const name = text(h1);

    const thumbEl =
        q(doc, ".tab-summary img") ||
        q(doc, ".summary_image img") ||
        q(doc, "img");

    const channelThumbnail = attr(thumbEl, "data-src") || attr(thumbEl, "src");

    const mangaId = url.split("/manga/")[1] || url;
    const id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);

    return new PlatformChannel({
        id: id,
        name: name,
        thumbnail: channelThumbnail,
        banner: "",
        subscribers: 0,
        description: "",
        url: url,
        urlAlternatives: [],
        links: {}
    });
};

source.getChannelCapabilities = () => {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological]
    };
};

source.getChannelContents = function (url, type, order, filters, continuationToken) {
    // Some WP Manga themes return title/thumb from the normal page, while chapters are AJAX.
    // Be defensive: fetch the base page for metadata (less likely to break).
    const baseHtml = httpGetOrThrow(url);
    const baseDoc = parseHtmlOrThrow(url, baseHtml);

    const titleEl = q(baseDoc, "h1") || q(baseDoc, ".post-title h1") || q(baseDoc, ".post-title");
    const mangaTitle = text(titleEl) || "Unknown Title";

    const imgEl = q(baseDoc, ".summary_image img") || q(baseDoc, ".tab-summary img") || q(baseDoc, "img");
    const mangaThumbnail = attr(imgEl, "data-src") || attr(imgEl, "src");

    const mangaId = url.split("/manga/")[1] || url;
    const authorId = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);
    const author = new PlatformAuthorLink(authorId, mangaTitle, url, mangaThumbnail, 0, "");

    // POST returns the chapter list HTML
    const postUrl = url + "ajax/chapters";
    const chaptersHtml = httpPostOrThrow(postUrl, "", {});
    const doc = parseHtmlOrThrow(postUrl, chaptersHtml);

    const chapters = [];
    for (const item of qAll(doc, "li")) {
        try {
            const a = requireEl(q(item, "a"), "chapter anchor", postUrl, "li a");
            const mangaChapter = text(a);
            const mangaChapterLink = attr(a, "href");

            const timeEl = q(item, "i") || q(item, ".chapter-release-date") || q(item, "span");
            const mangaPostedTime = extract_Timestamp(text(timeEl));

            // Use URL as stable ID, fallback to chapter name
            const chapterId = new PlatformID(PLATFORM, mangaChapterLink || mangaChapter, config.id, PLATFORM_CLAIMTYPE);

            const chapter = {
                id: chapterId,
                author: author,
                name: mangaChapter,
                datetime: mangaPostedTime,
                thumbnails: [],
                description: "",
                url: mangaChapterLink,
                images: [],
                contentUrl: mangaChapterLink,
                contentName: mangaChapter,
                contentDescription: ""
            };

            chapters.push(new PlatformNestedMediaContent(chapter));
        } catch (e) {
            console.log("Skipped chapter due to parse error: " + asString(e));
        }
    }

    return new ContentPager(chapters, false, { continuationToken });
};

source.isContentDetailsUrl = function (url) {
    // keep your preference
    return false;
};

source.getContentDetails = function (url) {
    // If you ever enable this, keep it safe + CF-aware
    const html = httpGetOrThrow(url);
    const doc = parseHtmlOrThrow(url, html);

    const mangaId = url.split("/manga/")[1] || url;
    const images = [];
    const thumbnailsArray = [];

    for (const item of qAll(doc, "img")) {
        const dataSrc = attr(item, "data-src") || attr(item, "src");
        if (dataSrc) {
            images.push(dataSrc);
            thumbnailsArray.push(new Thumbnails([new Thumbnail(dataSrc, 1080)]));
        }
    }

    const id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);

    return new PlatformNestedMediaContentDetails({
        id: id,
        name: mangaId,
        author: new PlatformAuthorLink(id, mangaId, url, "", 0, ""),
        datetime: 0,
        url: url,
        description: "",
        images: images,
        thumbnails: thumbnailsArray,
        rating: new RatingLikes(0),
        textType: Type.Text.RAW,
        content: ""
    });
};

source.getComments = function (url, continuationToken) {
    return [];
};
