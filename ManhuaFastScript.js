const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;
const REGEX_HUMAN_AGO = new RegExp("([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago");
const REGEX_CHANNEL_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+)\/$");
const REGEX_CONTENT_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+(?:\/[^\/]+)+)\/$");

const config = {};

// Standard browser User-Agent to reduce Cloudflare blocks.
// Grayjay's default UA is often flagged as bot traffic.
const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://manhuafast.com/"
};

// ============================================================
// ASSERT HELPERS — All of these THROW on failure. No silent fallbacks.
// ============================================================

/**
 * Checks for Cloudflare challenge pages in response HTML.
 * Throws with a clear message if detected.
 */
function detectCloudflare(body, url) {
    if (!body || typeof body !== "string") return;

    // Cloudflare JS challenge
    if (body.indexOf("Just a moment...") !== -1 || body.indexOf("cf-browser-verification") !== -1) {
        throw new ScriptException("Captcha required");
    }
}

/**
 * HTTP GET with validation. Throws on any failure.
 */
function requestGET(url, extraHeaders) {
    const headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
    let response;
    try {
        response = http.GET(url, headers, false);
    } catch (e) {
        throw new ScriptException("[ManhuaFast] HTTP GET FAILED for " + url + ": " + e.message);
    }

    if (!response) {
        throw new ScriptException("[ManhuaFast] NULL RESPONSE from GET " + url);
    }
    if (response.code && response.code >= 400) {
        throw new ScriptException("[ManhuaFast] HTTP " + response.code + " from GET " + url +
            (response.code === 403 ? " (likely Cloudflare block)" : "") +
            (response.code === 503 ? " (likely Cloudflare challenge)" : ""));
    }
    if (!response.body || response.body.trim().length === 0) {
        throw new ScriptException("[ManhuaFast] EMPTY BODY from GET " + url + " (HTTP " + (response.code || "unknown") + ")");
    }

    detectCloudflare(response.body, url);
    return response;
}

/**
 * HTTP POST with validation. Throws on any failure.
 */
function requestPOST(url, postBody, extraHeaders) {
    const headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
    let response;
    try {
        response = http.POST(url, postBody || "", headers, false);
    } catch (e) {
        throw new ScriptException("[ManhuaFast] HTTP POST FAILED for " + url + ": " + e.message);
    }

    if (!response) {
        throw new ScriptException("[ManhuaFast] NULL RESPONSE from POST " + url);
    }
    if (response.code && response.code >= 400) {
        throw new ScriptException("[ManhuaFast] HTTP " + response.code + " from POST " + url);
    }
    if (!response.body || response.body.trim().length === 0) {
        throw new ScriptException("[ManhuaFast] EMPTY BODY from POST " + url);
    }

    detectCloudflare(response.body, url);
    return response;
}

/**
 * Parse HTML. Throws if input is empty or parsing fails.
 */
function parseHTML(html, url) {
    if (!html || typeof html !== "string" || html.trim().length === 0) {
        throw new ScriptException("[ManhuaFast] CANNOT PARSE: received empty/null HTML from " + url);
    }
    const doc = domParser.parseFromString(html, "text/html");
    if (!doc) {
        throw new ScriptException("[ManhuaFast] DOM PARSE RETURNED NULL for " + url);
    }
    return doc;
}

/**
 * Assert that a querySelector result is not null.
 * Always throws with context about WHERE the selector failed and on WHICH URL.
 */
function requireElement(parent, selector, context) {
    if (!parent) {
        throw new ScriptException("[ManhuaFast] PARENT ELEMENT IS NULL when querying '" + selector + "' in " + context);
    }
    const el = parent.querySelector(selector);
    if (!el) {
        throw new ScriptException("[ManhuaFast] ELEMENT NOT FOUND: '" + selector + "' in " + context +
            " — The page structure may have changed, or Cloudflare returned a non-content page.");
    }
    return el;
}

/**
 * Assert that querySelectorAll returns at least one result.
 */
function requireElements(parent, selector, context) {
    if (!parent) {
        throw new ScriptException("[ManhuaFast] PARENT ELEMENT IS NULL when querying '" + selector + "' in " + context);
    }
    const els = parent.querySelectorAll(selector);
    if (!els || els.length === 0) {
        throw new ScriptException("[ManhuaFast] NO ELEMENTS FOUND: '" + selector + "' in " + context +
            " — Expected at least 1 match. The page structure may have changed or the response was blocked.");
    }
    return els;
}

/**
 * Assert textContent exists and is non-empty.
 */
function requireText(element, context) {
    if (!element) {
        throw new ScriptException("[ManhuaFast] NULL ELEMENT when reading textContent in " + context);
    }
    const text = element.textContent;
    if (text === null || text === undefined) {
        throw new ScriptException("[ManhuaFast] textContent IS NULL/UNDEFINED on element in " + context);
    }
    return text.trim();
}

/**
 * Assert getAttribute exists and is non-empty.
 */
function requireAttr(element, attr, context) {
    if (!element) {
        throw new ScriptException("[ManhuaFast] NULL ELEMENT when reading attribute '" + attr + "' in " + context);
    }
    const val = element.getAttribute(attr);
    if (!val) {
        throw new ScriptException("[ManhuaFast] ATTRIBUTE '" + attr + "' IS MISSING/EMPTY on element in " + context);
    }
    return val;
}

/**
 * Get image src, trying data-src first, then src. Throws if neither exists.
 */
function requireImageSrc(imgElement, context) {
    if (!imgElement) {
        throw new ScriptException("[ManhuaFast] NULL IMG ELEMENT in " + context);
    }
    const dataSrc = imgElement.getAttribute("data-src");
    if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();

    const src = imgElement.getAttribute("src");
    if (src && src.trim().length > 0) return src.trim();

    throw new ScriptException("[ManhuaFast] IMG HAS NO data-src OR src in " + context);
}

/**
 * Optional image src — returns empty string instead of throwing.
 * Use ONLY for getContentDetails where some <img> tags are decorative/nav.
 */
function optionalImageSrc(imgElement) {
    if (!imgElement) return "";
    const dataSrc = imgElement.getAttribute("data-src");
    if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();
    const src = imgElement.getAttribute("src");
    if (src && src.trim().length > 0) return src.trim();
    return "";
}

// ============================================================
// Timestamp extraction
// ============================================================
function extract_Timestamp(str) {
    if (!str) return 0;

    const match = str.match(REGEX_HUMAN_AGO);
    if (match) {
        const value = parseInt(match[1]);
        if (isNaN(value)) return 0;
        const now = parseInt(new Date().getTime() / 1000);

        switch (match[2]) {
            case "second": case "seconds": return now - value;
            case "min":    case "mins":    return now - value * 60;
            case "hour":   case "hours":   return now - value * 3600;
            case "day":    case "days":    return now - value * 86400;
            case "week":   case "weeks":   return now - value * 604800;
            case "month":  case "months":  return now - value * 2592000;
            case "year":   case "years":   return now - value * 31536000;
            default:
                throw new ScriptException("[ManhuaFast] UNKNOWN TIME UNIT: '" + match[2] + "' in timestamp string: " + str);
        }
    }

    const date = new Date(str);
    if (!isNaN(date.getTime())) {
        return Math.floor(date.getTime() / 1000);
    }

    // Genuinely unparseable date — not an error, just no date available
    return 0;
}

// ============================================================
// Plugin lifecycle
// ============================================================
source.enable = function (conf) {
    this.config = conf;
    console.log("[ManhuaFast] Plugin enabled");
}

// ============================================================
// getHome
// ============================================================
source.getHome = function(continuationToken) {
    const homeUrl = "https://manhuafast.com/";
    const response = requestGET(homeUrl);
    const doc = parseHTML(response.body, homeUrl);

    const items = requireElements(doc, ".page-item-detail", "getHome(" + homeUrl + ")");
    const mangaItems = [];

    items.forEach((item, index) => {
        const ctx = "getHome item[" + index + "]";

        const mangaAnchor = requireElement(item, ".post-title a", ctx);
        const mangaChapterAnchor = requireElement(item, ".chapter-item .chapter a", ctx);

        const mangaTitle = requireText(mangaAnchor, ctx + " .post-title a");
        const mangaLink = requireAttr(mangaAnchor, "href", ctx + " .post-title a[href]");

        const mangaIdParts = mangaLink.split('/manga/');
        if (mangaIdParts.length < 2) {
            throw new ScriptException("[ManhuaFast] UNEXPECTED URL FORMAT: '" + mangaLink + "' does not contain '/manga/' in " + ctx);
        }
        const mangaId = mangaIdParts[1];

        const mangaChapter = requireText(mangaChapterAnchor, ctx + " chapter anchor");
        const mangaChapterLink = requireAttr(mangaChapterAnchor, "href", ctx + " chapter anchor[href]");

        const postOnEl = requireElement(item, ".post-on", ctx);
        const mangaPostedTime = extract_Timestamp(requireText(postOnEl, ctx + " .post-on"));

        const imgEl = requireElement(item, "img", ctx);
        const mangaThumbnail = requireImageSrc(imgEl, ctx + " img");

        const id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);
        const author = new PlatformAuthorLink(id, mangaTitle, mangaLink, mangaThumbnail, 0, "");

        mangaItems.push(new PlatformNestedMediaContent({
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
        }));
    });

    return new ContentPager(mangaItems, false, { continuationToken });
}

// ============================================================
// Search
// ============================================================
source.searchSuggestions = function(query) {
    return [];
}

source.getSearchCapabilities = function() {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological, "^release_time"],
        filters: []
    };
}

source.search = function(query, type, order, filters, continuationToken) {
    return [];
}

// ============================================================
// searchChannels
// ============================================================
source.searchChannels = function(query, continuationToken) {
    const searchUrl = "https://manhuafast.com/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
    const response = requestGET(searchUrl);
    const doc = parseHTML(response.body, searchUrl);

    // Search may legitimately return 0 results — don't require elements here
    const anchors = doc.querySelectorAll(".post-title a");
    const channels = [];

    if (!anchors || anchors.length === 0) {
        console.log("[ManhuaFast] Search returned 0 results for: " + query);
        return new ChannelPager([], false, { query, continuationToken });
    }

    anchors.forEach((item, index) => {
        const ctx = "searchChannels[" + index + "] query='" + query + "'";

        const href = requireAttr(item, "href", ctx + " a[href]");
        const hrefParts = href.split('/manga/');
        if (hrefParts.length < 2) {
            throw new ScriptException("[ManhuaFast] UNEXPECTED SEARCH URL FORMAT: '" + href + "' in " + ctx);
        }

        const mangaId = new PlatformID(PLATFORM, hrefParts[1], config.id, PLATFORM_CLAIMTYPE);
        const mangaName = requireText(item, ctx + " a text");

        channels.push(new PlatformChannel({
            id: mangaId,
            name: mangaName,
            thumbnail: "",
            banner: "",
            subscribers: 0,
            description: "",
            url: href,
            urlAlternatives: [],
            links: {}
        }));
    });

    return new ChannelPager(channels, false, { query, continuationToken });
}

// ============================================================
// Channel methods
// ============================================================
source.isChannelUrl = function(url) {
    return REGEX_CHANNEL_URL.test(url);
}

source.getChannel = function(url) {
    const ctx = "getChannel(" + url + ")";
    const response = requestGET(url);
    const doc = parseHTML(response.body, url);

    const h1 = requireElement(doc, "h1", ctx);
    const name = requireText(h1, ctx + " h1");

    const summaryImg = requireElement(doc, ".tab-summary img", ctx);
    const channelThumbnail = requireImageSrc(summaryImg, ctx + " .tab-summary img");

    const mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: '" + url + "' has no '/manga/' segment");
    }
    const mangaId = mangaIdParts[1];
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
}

source.getChannelCapabilities = () => {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological]
    };
}

// ============================================================
// getChannelContents
// ============================================================
source.getChannelContents = function(url, type, order, filters, continuationToken) {
    const ctx = "getChannelContents(" + url + ")";

    // GET the channel page for metadata
    const getResponse = requestGET(url);
    const getDoc = parseHTML(getResponse.body, url);

    const mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: no '/manga/' in " + url);
    }
    const mangaId = mangaIdParts[1];

    const h1 = requireElement(getDoc, "h1", ctx);
    const mangaTitle = requireText(h1, ctx + " h1");

    const summaryImg = requireElement(getDoc, ".summary_image img", ctx);
    const mangaThumbnail = requireImageSrc(summaryImg, ctx + " .summary_image img");

    const AuthorId = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);
    const author = new PlatformAuthorLink(AuthorId, mangaTitle, url, mangaThumbnail, 0, "");

    // POST to get the chapter list
    const chapterUrl = url + "ajax/chapters/";
    const postResponse = requestPOST(chapterUrl, "");
    const postDoc = parseHTML(postResponse.body, chapterUrl);

    const listItems = requireElements(postDoc, "li", ctx + " chapters POST");
    const chapters = [];

    listItems.forEach((item, index) => {
        const itemCtx = ctx + " chapter[" + index + "]";

        const anchor = requireElement(item, "a", itemCtx);
        const mangaChapter = requireText(anchor, itemCtx + " a text");
        const mangaChapterLink = requireAttr(anchor, "href", itemCtx + " a[href]");

        const iEl = requireElement(item, "i", itemCtx);
        const mangaPostedTime = extract_Timestamp(requireText(iEl, itemCtx + " i"));

        const chapterId = new PlatformID(PLATFORM, mangaChapter, config.id, PLATFORM_CLAIMTYPE);

        chapters.push(new PlatformNestedMediaContent({
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
        }));
    });

    return new ContentPager(chapters, false, { continuationToken });
}

// ============================================================
// Content details
// ============================================================
source.isContentDetailsUrl = function(url) {
    return false;
}

source.getContentDetails = function(url) {
    const ctx = "getContentDetails(" + url + ")";
    const response = requestGET(url);
    let html = response.body.replace(/\s+/g, ' ').trim();
    const doc = parseHTML(html, url);

    const mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CONTENT URL: no '/manga/' in " + url);
    }
    const mangaId = mangaIdParts[1];

    const images = [];
    const thumbnailsArray = [];

    const imgElements = doc.querySelectorAll("img");
    if (!imgElements || imgElements.length === 0) {
        throw new ScriptException("[ManhuaFast] NO IMG ELEMENTS FOUND in " + ctx +
            " — Page may be blocked or chapter has no images.");
    }

    imgElements.forEach((item, index) => {
        // Some <img> are nav/decorative, so don't require src on every one
        const imgSrc = optionalImageSrc(item);
        if (imgSrc) {
            images.push(imgSrc);
            thumbnailsArray.push(new Thumbnails([new Thumbnail(imgSrc, 1080)]));
        }
    });

    if (images.length === 0) {
        throw new ScriptException("[ManhuaFast] FOUND " + imgElements.length + " <img> tags but NONE had data-src or src in " + ctx);
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
}

// ============================================================
// Comments
// ============================================================
source.getComments = function(url, continuationToken) {
    return [];
}

