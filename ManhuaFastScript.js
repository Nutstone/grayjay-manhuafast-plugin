const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;
const REGEX_HUMAN_AGO = new RegExp("([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago");
const REGEX_CHANNEL_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+)\/$");
const REGEX_CONTENT_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+(?:\/[^\/]+)+)\/$");

const config = {};

// Standard browser User-Agent to reduce Cloudflare blocks.
const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://manhuafast.com/"
};

// ============================================================
// CLOUDFLARE DETECTION + CAPTCHA TRIGGER
// ============================================================

/**
 * Returns true if the response body looks like a Cloudflare challenge/block page.
 * Pure detection — does NOT throw.
 */
function isCloudflare(body) {
    if (!body || typeof body !== "string") return false;
    if (body.indexOf("Just a moment...") !== -1) return true;
    if (body.indexOf("cf-browser-verification") !== -1) return true;
    if (body.indexOf("Attention Required! | Cloudflare") !== -1) return true;
    if (body.indexOf("cf-captcha-container") !== -1) return true;
    if (body.indexOf("Enable JavaScript and cookies to continue") !== -1) return true;
    if (body.indexOf("challenges.cloudflare.com") !== -1) return true;
    if (body.indexOf("cf-error-details") !== -1) return true;
    if (body.indexOf("error code: 10") !== -1 && body.indexOf("cloudflare") !== -1) return true;
    return false;
}

/**
 * Log the real reason, then throw the EXACT magic string that Grayjay's engine
 * pattern-matches in InterceptExceptions to open the captcha WebView.
 *
 * ANY other string (like "[ManhuaFast] Cloudflare blocked") will NOT trigger it.
 */
function throwCaptchaRequired(url, httpCode) {
    console.log("[ManhuaFast] CLOUDFLARE DETECTED at " + url +
        " (HTTP " + (httpCode || "?") + ") — triggering captcha WebView");
    throw new ScriptException("Captcha required");
}

// ============================================================
// HTTP WRAPPERS — Cloudflare check runs BEFORE generic error handling
// ============================================================

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

    // Check for Cloudflare FIRST on any response (403, 503, or even 200 challenge pages)
    if (response.body && isCloudflare(response.body)) {
        throwCaptchaRequired(url, response.code);
    }

    // Non-Cloudflare HTTP errors
    if (response.code && response.code >= 400) {
        throw new ScriptException("[ManhuaFast] HTTP " + response.code + " from GET " + url);
    }
    if (!response.body || response.body.trim().length === 0) {
        throw new ScriptException("[ManhuaFast] EMPTY BODY from GET " + url +
            " (HTTP " + (response.code || "unknown") + ")");
    }

    return response;
}

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

    // Check for Cloudflare FIRST
    if (response.body && isCloudflare(response.body)) {
        throwCaptchaRequired(url, response.code);
    }

    if (response.code && response.code >= 400) {
        throw new ScriptException("[ManhuaFast] HTTP " + response.code + " from POST " + url);
    }
    if (!response.body || response.body.trim().length === 0) {
        throw new ScriptException("[ManhuaFast] EMPTY BODY from POST " + url);
    }

    return response;
}

// ============================================================
// DOM HELPERS — All throw with context on failure. No silent fallbacks.
// ============================================================

function parseHTML(html, url) {
    if (!html || typeof html !== "string" || html.trim().length === 0) {
        throw new ScriptException("[ManhuaFast] CANNOT PARSE: received empty/null HTML from " + url);
    }
    var doc = domParser.parseFromString(html, "text/html");
    if (!doc) {
        throw new ScriptException("[ManhuaFast] DOM PARSE RETURNED NULL for " + url);
    }
    return doc;
}

function requireElement(parent, selector, context) {
    if (!parent) {
        throw new ScriptException("[ManhuaFast] PARENT ELEMENT IS NULL when querying '" + selector + "' in " + context);
    }
    var el = parent.querySelector(selector);
    if (!el) {
        throw new ScriptException("[ManhuaFast] ELEMENT NOT FOUND: '" + selector + "' in " + context +
            " — Page structure may have changed or Cloudflare returned a non-content page.");
    }
    return el;
}

function requireElements(parent, selector, context) {
    if (!parent) {
        throw new ScriptException("[ManhuaFast] PARENT ELEMENT IS NULL when querying '" + selector + "' in " + context);
    }
    var els = parent.querySelectorAll(selector);
    if (!els || els.length === 0) {
        throw new ScriptException("[ManhuaFast] NO ELEMENTS FOUND: '" + selector + "' in " + context +
            " — Expected at least 1 match.");
    }
    return els;
}

function requireText(element, context) {
    if (!element) {
        throw new ScriptException("[ManhuaFast] NULL ELEMENT when reading textContent in " + context);
    }
    var text = element.textContent;
    if (text === null || text === undefined) {
        throw new ScriptException("[ManhuaFast] textContent IS NULL/UNDEFINED on element in " + context);
    }
    return text.trim();
}

function requireAttr(element, attr, context) {
    if (!element) {
        throw new ScriptException("[ManhuaFast] NULL ELEMENT when reading attribute '" + attr + "' in " + context);
    }
    var val = element.getAttribute(attr);
    if (!val) {
        throw new ScriptException("[ManhuaFast] ATTRIBUTE '" + attr + "' IS MISSING/EMPTY on element in " + context);
    }
    return val;
}

function requireImageSrc(imgElement, context) {
    if (!imgElement) {
        throw new ScriptException("[ManhuaFast] NULL IMG ELEMENT in " + context);
    }
    var dataSrc = imgElement.getAttribute("data-src");
    if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();
    var src = imgElement.getAttribute("src");
    if (src && src.trim().length > 0) return src.trim();
    throw new ScriptException("[ManhuaFast] IMG HAS NO data-src OR src in " + context);
}

function optionalImageSrc(imgElement) {
    if (!imgElement) return "";
    var dataSrc = imgElement.getAttribute("data-src");
    if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();
    var src = imgElement.getAttribute("src");
    if (src && src.trim().length > 0) return src.trim();
    return "";
}

// ============================================================
// Timestamp extraction
// ============================================================
function extract_Timestamp(str) {
    if (!str) return 0;
    var match = str.match(REGEX_HUMAN_AGO);
    if (match) {
        var value = parseInt(match[1]);
        if (isNaN(value)) return 0;
        var now = parseInt(new Date().getTime() / 1000);
        switch (match[2]) {
            case "second": case "seconds": return now - value;
            case "min":    case "mins":    return now - value * 60;
            case "hour":   case "hours":   return now - value * 3600;
            case "day":    case "days":    return now - value * 86400;
            case "week":   case "weeks":   return now - value * 604800;
            case "month":  case "months":  return now - value * 2592000;
            case "year":   case "years":   return now - value * 31536000;
            default:
                throw new ScriptException("[ManhuaFast] UNKNOWN TIME UNIT: '" + match[2] + "'");
        }
    }
    var date = new Date(str);
    if (!isNaN(date.getTime())) {
        return Math.floor(date.getTime() / 1000);
    }
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
    var homeUrl = "https://manhuafast.com/";
    var response = requestGET(homeUrl);
    var doc = parseHTML(response.body, homeUrl);

    var items = requireElements(doc, ".page-item-detail", "getHome(" + homeUrl + ")");
    var mangaItems = [];

    items.forEach(function(item, index) {
        var ctx = "getHome item[" + index + "]";

        var mangaAnchor = requireElement(item, ".post-title a", ctx);
        var mangaChapterAnchor = requireElement(item, ".chapter-item .chapter a", ctx);

        var mangaTitle = requireText(mangaAnchor, ctx + " .post-title a");
        var mangaLink = requireAttr(mangaAnchor, "href", ctx + " .post-title a[href]");

        var mangaIdParts = mangaLink.split('/manga/');
        if (mangaIdParts.length < 2) {
            throw new ScriptException("[ManhuaFast] UNEXPECTED URL FORMAT: '" + mangaLink + "' in " + ctx);
        }
        var mangaId = mangaIdParts[1];

        var mangaChapter = requireText(mangaChapterAnchor, ctx + " chapter anchor");
        var mangaChapterLink = requireAttr(mangaChapterAnchor, "href", ctx + " chapter anchor[href]");

        var postOnEl = requireElement(item, ".post-on", ctx);
        var mangaPostedTime = extract_Timestamp(requireText(postOnEl, ctx + " .post-on"));

        var imgEl = requireElement(item, "img", ctx);
        var mangaThumbnail = requireImageSrc(imgEl, ctx + " img");

        var id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);
        var author = new PlatformAuthorLink(id, mangaTitle, mangaLink, mangaThumbnail, 0, "");

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

    return new ContentPager(mangaItems, false, { continuationToken: continuationToken });
}

// ============================================================
// Search
// ============================================================
source.searchSuggestions = function(query) { return []; }

source.getSearchCapabilities = function() {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological, "^release_time"],
        filters: []
    };
}

source.search = function(query, type, order, filters, continuationToken) { return []; }

// ============================================================
// searchChannels
// ============================================================
source.searchChannels = function(query, continuationToken) {
    var searchUrl = "https://manhuafast.com/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
    var response = requestGET(searchUrl);
    var doc = parseHTML(response.body, searchUrl);

    var anchors = doc.querySelectorAll(".post-title a");
    var channels = [];

    if (!anchors || anchors.length === 0) {
        console.log("[ManhuaFast] Search returned 0 results for: " + query);
        return new ChannelPager([], false, { query: query, continuationToken: continuationToken });
    }

    anchors.forEach(function(item, index) {
        var ctx = "searchChannels[" + index + "] query='" + query + "'";
        var href = requireAttr(item, "href", ctx + " a[href]");
        var hrefParts = href.split('/manga/');
        if (hrefParts.length < 2) {
            throw new ScriptException("[ManhuaFast] UNEXPECTED SEARCH URL: '" + href + "' in " + ctx);
        }

        var mangaId = new PlatformID(PLATFORM, hrefParts[1], config.id, PLATFORM_CLAIMTYPE);
        var mangaName = requireText(item, ctx + " a text");

        channels.push(new PlatformChannel({
            id: mangaId, name: mangaName, thumbnail: "", banner: "",
            subscribers: 0, description: "", url: href,
            urlAlternatives: [], links: {}
        }));
    });

    return new ChannelPager(channels, false, { query: query, continuationToken: continuationToken });
}

// ============================================================
// Channel methods
// ============================================================
source.isChannelUrl = function(url) { return REGEX_CHANNEL_URL.test(url); }

source.getChannel = function(url) {
    var ctx = "getChannel(" + url + ")";
    var response = requestGET(url);
    var doc = parseHTML(response.body, url);

    var h1 = requireElement(doc, "h1", ctx);
    var name = requireText(h1, ctx + " h1");
    var summaryImg = requireElement(doc, ".tab-summary img", ctx);
    var channelThumbnail = requireImageSrc(summaryImg, ctx + " .tab-summary img");

    var mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: '" + url + "'");
    }
    var id = new PlatformID(PLATFORM, mangaIdParts[1], config.id, PLATFORM_CLAIMTYPE);

    return new PlatformChannel({
        id: id, name: name, thumbnail: channelThumbnail, banner: "",
        subscribers: 0, description: "", url: url,
        urlAlternatives: [], links: {}
    });
}

source.getChannelCapabilities = function() {
    return { types: [Type.Feed.Mixed], sorts: [Type.Order.Chronological] };
}

// ============================================================
// getChannelContents
// ============================================================
source.getChannelContents = function(url, type, order, filters, continuationToken) {
    var ctx = "getChannelContents(" + url + ")";

    var getResponse = requestGET(url);
    var getDoc = parseHTML(getResponse.body, url);

    var mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: no '/manga/' in " + url);
    }
    var mangaId = mangaIdParts[1];

    var h1 = requireElement(getDoc, "h1", ctx);
    var mangaTitle = requireText(h1, ctx + " h1");
    var summaryImg = requireElement(getDoc, ".summary_image img", ctx);
    var mangaThumbnail = requireImageSrc(summaryImg, ctx + " .summary_image img");

    var AuthorId = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);
    var author = new PlatformAuthorLink(AuthorId, mangaTitle, url, mangaThumbnail, 0, "");

    var chapterUrl = url + "ajax/chapters/";
    var postResponse = requestPOST(chapterUrl, "");
    var postDoc = parseHTML(postResponse.body, chapterUrl);

    var listItems = requireElements(postDoc, "li", ctx + " chapters POST");
    var chapters = [];

    listItems.forEach(function(item, index) {
        var itemCtx = ctx + " chapter[" + index + "]";
        var anchor = requireElement(item, "a", itemCtx);
        var mangaChapter = requireText(anchor, itemCtx + " a text");
        var mangaChapterLink = requireAttr(anchor, "href", itemCtx + " a[href]");
        var iEl = requireElement(item, "i", itemCtx);
        var mangaPostedTime = extract_Timestamp(requireText(iEl, itemCtx + " i"));
        var chapterId = new PlatformID(PLATFORM, mangaChapter, config.id, PLATFORM_CLAIMTYPE);

        chapters.push(new PlatformNestedMediaContent({
            id: chapterId, author: author, name: mangaChapter,
            datetime: mangaPostedTime, thumbnails: [], description: "",
            url: mangaChapterLink, images: [],
            contentUrl: mangaChapterLink, contentName: mangaChapter,
            contentDescription: ""
        }));
    });

    return new ContentPager(chapters, false, { continuationToken: continuationToken });
}

// ============================================================
// Content details
// ============================================================
source.isContentDetailsUrl = function(url) { return false; }

source.getContentDetails = function(url) {
    var ctx = "getContentDetails(" + url + ")";
    var response = requestGET(url);
    var html = response.body.replace(/\s+/g, ' ').trim();
    var doc = parseHTML(html, url);

    var mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CONTENT URL: no '/manga/' in " + url);
    }
    var mangaId = mangaIdParts[1];

    var images = [];
    var thumbnailsArray = [];
    var imgElements = doc.querySelectorAll("img");
    if (!imgElements || imgElements.length === 0) {
        throw new ScriptException("[ManhuaFast] NO IMG ELEMENTS FOUND in " + ctx);
    }

    imgElements.forEach(function(item) {
        var imgSrc = optionalImageSrc(item);
        if (imgSrc) {
            images.push(imgSrc);
            thumbnailsArray.push(new Thumbnails([new Thumbnail(imgSrc, 1080)]));
        }
    });

    if (images.length === 0) {
        throw new ScriptException("[ManhuaFast] FOUND " + imgElements.length +
            " <img> tags but NONE had data-src or src in " + ctx);
    }

    var id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE);

    return new PlatformNestedMediaContentDetails({
        id: id, name: mangaId,
        author: new PlatformAuthorLink(id, mangaId, url, "", 0, ""),
        datetime: 0, url: url, description: "",
        images: images, thumbnails: thumbnailsArray,
        rating: new RatingLikes(0),
        textType: Type.Text.RAW, content: ""
    });
}

// ============================================================
// Comments
// ============================================================
source.getComments = function(url, continuationToken) { return []; }
