const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;
const REGEX_HUMAN_AGO = new RegExp("([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago");
// Trailing slash is optional so URLs without it still match (I)
const REGEX_CHANNEL_URL = new RegExp("^https:\/\/manhuafast\.(com|net)\/manga\/([^\/]+)\/?$");
// Chapter reader pages have two path segments under /manga/ (e.g. /manga/slug/chapter-1/)
const REGEX_CHAPTER_URL = new RegExp("^https:\/\/manhuafast\.(com|net)\/manga\/[^\/]+\/[^\/]+\/?$");

const BASE_URL_PRIMARY = "https://manhuafast.com";
const BASE_URL_FALLBACK = "https://manhuafast.net";

const config = {};

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5"
};

// ============================================================
// HTTP WRAPPERS — Try primary (.com), fall back to (.net) on failure
// ============================================================

/**
 * If `url` starts with BASE_URL_PRIMARY, return the equivalent
 * BASE_URL_FALLBACK url. Otherwise return null (no fallback available).
 */
function getFallbackUrl(url) {
    if (url.indexOf(BASE_URL_PRIMARY) === 0) {
        return url.replace(BASE_URL_PRIMARY, BASE_URL_FALLBACK);
    }
    return null;
}

function isUsableResponse(response) {
    if (!response) return false;
    if (response.code && response.code >= 400) return false;
    if (!response.body || response.body.trim().length === 0) return false;
    return true;
}

function requestGET(url, extraHeaders) {
    var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
    headers["Referer"] = url.indexOf(BASE_URL_FALLBACK) === 0
        ? BASE_URL_FALLBACK + "/"
        : BASE_URL_PRIMARY + "/";

    var response;
    try {
        response = http.GET(url, headers, false);
    } catch (e) {
        response = null;
    }

    if (isUsableResponse(response)) return response;

    // Try fallback domain
    var fallbackUrl = getFallbackUrl(url);
    if (fallbackUrl) {
        console.log("[ManhuaFast] Primary request failed for " + url + " — trying fallback: " + fallbackUrl);
        headers["Referer"] = BASE_URL_FALLBACK + "/";
        try {
            response = http.GET(fallbackUrl, headers, false);
        } catch (e) {
            throw new ScriptException("[ManhuaFast] HTTP GET FAILED for both " + url + " and " + fallbackUrl + ": " + e.message);
        }
        if (isUsableResponse(response)) return response;
        throw new ScriptException("[ManhuaFast] HTTP GET FAILED for both " + url +
            " (primary) and " + fallbackUrl + " (fallback). Last HTTP code: " + (response ? response.code : "null"));
    }

    // No fallback available (URL wasn't on the primary domain)
    throw new ScriptException("[ManhuaFast] HTTP GET FAILED for " + url +
        " — HTTP " + (response ? response.code : "null/error"));
}

function requestPOST(url, postBody, extraHeaders) {
    var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
    headers["Referer"] = url.indexOf(BASE_URL_FALLBACK) === 0
        ? BASE_URL_FALLBACK + "/"
        : BASE_URL_PRIMARY + "/";

    var response;
    try {
        response = http.POST(url, postBody || "", headers, false);
    } catch (e) {
        response = null;
    }

    if (isUsableResponse(response)) return response;

    var fallbackUrl = getFallbackUrl(url);
    if (fallbackUrl) {
        console.log("[ManhuaFast] Primary POST failed for " + url + " — trying fallback: " + fallbackUrl);
        headers["Referer"] = BASE_URL_FALLBACK + "/";
        try {
            response = http.POST(fallbackUrl, postBody || "", headers, false);
        } catch (e) {
            throw new ScriptException("[ManhuaFast] HTTP POST FAILED for both " + url + " and " + fallbackUrl + ": " + e.message);
        }
        if (isUsableResponse(response)) return response;
        throw new ScriptException("[ManhuaFast] HTTP POST FAILED for both " + url +
            " (primary) and " + fallbackUrl + " (fallback). Last HTTP code: " + (response ? response.code : "null"));
    }

    throw new ScriptException("[ManhuaFast] HTTP POST FAILED for " + url +
        " — HTTP " + (response ? response.code : "null/error"));
}

// ============================================================
// DOM HELPERS
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
        throw new ScriptException("[ManhuaFast] ELEMENT NOT FOUND: '" + selector + "' in " + context);
    }
    return el;
}

function requireElements(parent, selector, context) {
    if (!parent) {
        throw new ScriptException("[ManhuaFast] PARENT ELEMENT IS NULL when querying '" + selector + "' in " + context);
    }
    var els = parent.querySelectorAll(selector);
    if (!els || els.length === 0) {
        throw new ScriptException("[ManhuaFast] NO ELEMENTS FOUND: '" + selector + "' in " + context);
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
// URL normalization helpers
// ============================================================

// Rewrite fallback-domain URLs to primary domain
function toPrimaryUrl(url) {
    if (!url) return url;
    if (url.indexOf(BASE_URL_FALLBACK) === 0) {
        return url.replace(BASE_URL_FALLBACK, BASE_URL_PRIMARY);
    }
    return url;
}

// Ensure a manga channel URL has a trailing slash (I)
// so that appending "ajax/chapters/" always works correctly
function ensureTrailingSlash(url) {
    if (!url) return url;
    return url[url.length - 1] === '/' ? url : url + '/';
}

// Strip trailing slash from a path segment used as an ID
function stripTrailingSlash(str) {
    if (!str) return str;
    return str[str.length - 1] === '/' ? str.slice(0, -1) : str;
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
    var homeUrl = BASE_URL_PRIMARY + "/";
    var response = requestGET(homeUrl);
    var doc = parseHTML(response.body, homeUrl);

    var items = requireElements(doc, ".page-item-detail", "getHome(" + homeUrl + ")");
    var mangaItems = [];

    items.forEach(function(item, index) {
        var ctx = "getHome item[" + index + "]";

        var mangaAnchor = requireElement(item, ".post-title a", ctx);
        var mangaChapterAnchor = requireElement(item, ".chapter-item .chapter a", ctx);

        var mangaTitle = requireText(mangaAnchor, ctx + " .post-title a");
        var mangaLink = toPrimaryUrl(requireAttr(mangaAnchor, "href", ctx + " .post-title a[href]"));

        var mangaIdParts = mangaLink.split('/manga/');
        if (mangaIdParts.length < 2) {
            throw new ScriptException("[ManhuaFast] UNEXPECTED URL FORMAT: '" + mangaLink + "' in " + ctx);
        }
        var mangaId = stripTrailingSlash(mangaIdParts[1]);

        var mangaChapter = requireText(mangaChapterAnchor, ctx + " chapter anchor");
        var mangaChapterLink = toPrimaryUrl(requireAttr(mangaChapterAnchor, "href", ctx + " chapter anchor[href]"));

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

// Updated sort labels to match what search() actually passes to the API (F)
source.getSearchCapabilities = function() {
    return {
        types: [Type.Feed.Mixed],
        sorts: ["Latest", "A-Z", "Rating", "Most Viewed"],
        filters: []
    };
}

// Implemented: searches manga by title, supports sort and pagination (F, G)
source.search = function(query, type, order, filters, continuationToken) {
    var page = (continuationToken && typeof continuationToken.page === "number") ? continuationToken.page : 1;

    // Map sort label to Madara's m_orderby parameter
    var sortParam = "";
    if (order === "A-Z")          sortParam = "&m_orderby=alphabet";
    else if (order === "Rating")  sortParam = "&m_orderby=rating";
    else if (order === "Most Viewed") sortParam = "&m_orderby=views";
    // "Latest" (default) needs no extra param

    var searchUrl = BASE_URL_PRIMARY +
        (page > 1 ? "/page/" + page + "/" : "/") +
        "?s=" + encodeURIComponent(query) + "&post_type=wp-manga" + sortParam;

    var response = requestGET(searchUrl);
    var doc = parseHTML(response.body, searchUrl);

    var results = [];

    // Try container-based selection to get both title and thumbnail
    var items = doc.querySelectorAll(".c-tabs-item__content");
    if (!items || items.length === 0) {
        items = doc.querySelectorAll(".page-item-detail");
    }

    if (items && items.length > 0) {
        items.forEach(function(item, index) {
            var anchor = item.querySelector(".post-title a");
            if (!anchor) return;

            var href = toPrimaryUrl(anchor.getAttribute("href") || "");
            var hrefParts = href.split('/manga/');
            if (hrefParts.length < 2) return;

            var mangaSlug = stripTrailingSlash(hrefParts[1]);
            var id = new PlatformID(PLATFORM, mangaSlug, config.id, PLATFORM_CLAIMTYPE);
            var name = anchor.textContent.trim();

            var img = item.querySelector("img");
            var thumbnail = img ? optionalImageSrc(img) : "";
            var author = new PlatformAuthorLink(id, name, href, thumbnail, 0, "");

            results.push(new PlatformNestedMediaContent({
                id: id,
                author: author,
                name: name,
                datetime: 0,
                url: href,
                thumbnails: thumbnail ? [new Thumbnails([new Thumbnail(thumbnail, 400)])] : [],
                description: "",
                images: [],
                contentUrl: href,
                contentName: name,
                contentDescription: ""
            }));
        });
    }

    var hasNextPage = !!doc.querySelector("a.next.page-numbers");
    return new ContentPager(results, hasNextPage, { page: page + 1 });
}

// ============================================================
// searchChannels — with cover thumbnail extraction and pagination (A, G)
// ============================================================
source.searchChannels = function(query, continuationToken) {
    var page = (continuationToken && typeof continuationToken.page === "number") ? continuationToken.page : 1;

    var searchUrl = BASE_URL_PRIMARY +
        (page > 1 ? "/page/" + page + "/" : "/") +
        "?s=" + encodeURIComponent(query) + "&post_type=wp-manga";

    var response = requestGET(searchUrl);
    var doc = parseHTML(response.body, searchUrl);

    var channels = [];

    // Container-based selection: picks up both .post-title a (link) and img (thumbnail)
    var items = doc.querySelectorAll(".c-tabs-item__content");
    if (!items || items.length === 0) {
        items = doc.querySelectorAll(".page-item-detail");
    }

    if (items && items.length > 0) {
        items.forEach(function(item, index) {
            var ctx = "searchChannels[" + index + "] query='" + query + "'";
            var anchor = item.querySelector(".post-title a");
            if (!anchor) return;

            var href = toPrimaryUrl(anchor.getAttribute("href") || "");
            var hrefParts = href.split('/manga/');
            if (hrefParts.length < 2) return;

            var img = item.querySelector("img");
            var thumbnail = img ? optionalImageSrc(img) : "";

            var mangaId = new PlatformID(PLATFORM, stripTrailingSlash(hrefParts[1]), config.id, PLATFORM_CLAIMTYPE);
            var mangaName = anchor.textContent.trim();

            channels.push(new PlatformChannel({
                id: mangaId, name: mangaName, thumbnail: thumbnail, banner: "",
                subscribers: 0, description: "", url: href,
                urlAlternatives: [], links: {}
            }));
        });
    } else {
        // Fallback: anchor-only selection (no thumbnail available)
        var anchors = doc.querySelectorAll(".post-title a");
        if (anchors && anchors.length > 0) {
            anchors.forEach(function(item, index) {
                var href = toPrimaryUrl(item.getAttribute("href") || "");
                var hrefParts = href.split('/manga/');
                if (hrefParts.length < 2) return;

                var mangaId = new PlatformID(PLATFORM, stripTrailingSlash(hrefParts[1]), config.id, PLATFORM_CLAIMTYPE);
                var mangaName = item.textContent.trim();

                channels.push(new PlatformChannel({
                    id: mangaId, name: mangaName, thumbnail: "", banner: "",
                    subscribers: 0, description: "", url: href,
                    urlAlternatives: [], links: {}
                }));
            });
        }
    }

    if (channels.length === 0) {
        console.log("[ManhuaFast] Search returned 0 results for: " + query);
    }

    var hasNextPage = !!doc.querySelector("a.next.page-numbers");
    return new ChannelPager(channels, hasNextPage, { query: query, page: page + 1 });
}

// ============================================================
// Channel methods
// ============================================================
source.isChannelUrl = function(url) { return REGEX_CHANNEL_URL.test(url); }

// Includes manga synopsis extraction (C)
source.getChannel = function(url) {
    url = ensureTrailingSlash(toPrimaryUrl(url)); // (I)
    var ctx = "getChannel(" + url + ")";
    var response = requestGET(url);
    var doc = parseHTML(response.body, url);

    var h1 = requireElement(doc, "h1", ctx);
    var name = requireText(h1, ctx + " h1");
    var summaryImg = requireElement(doc, ".tab-summary img", ctx);
    var channelThumbnail = requireImageSrc(summaryImg, ctx + " .tab-summary img");

    // Extract synopsis — Madara theme uses several possible selectors (C)
    var description = "";
    var descEls = doc.querySelectorAll(".description-summary p, .summary__content p, .summary-content p");
    if (descEls && descEls.length > 0) {
        var parts = [];
        descEls.forEach(function(p) {
            var text = p.textContent.trim();
            if (text) parts.push(text);
        });
        description = parts.join("\n");
    }

    var mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: '" + url + "'");
    }
    var id = new PlatformID(PLATFORM, stripTrailingSlash(mangaIdParts[1]), config.id, PLATFORM_CLAIMTYPE);

    return new PlatformChannel({
        id: id, name: name, thumbnail: channelThumbnail, banner: "",
        subscribers: 0, description: description, url: url,
        urlAlternatives: [], links: {}
    });
}

// Fixed sort labels: user-friendly strings instead of "CHRONOLOGICAL" (1)
source.getChannelCapabilities = function() {
    return {
        types: [Type.Feed.Mixed],
        sorts: ["Newest First", "Oldest First"],
        filters: []
    };
}

// ============================================================
// getChannelContents — fixed sort comparison, added pagination (2, H, I)
// ============================================================
source.getChannelContents = function(url, type, order, filters, continuationToken) {
    url = ensureTrailingSlash(toPrimaryUrl(url)); // (I)
    var ctx = "getChannelContents(" + url + ")";

    var PAGE_SIZE = 100;
    var offset = (continuationToken && typeof continuationToken.offset === "number") ? continuationToken.offset : 0;

    var getResponse = requestGET(url);
    var getDoc = parseHTML(getResponse.body, url);

    var mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: no '/manga/' in " + url);
    }
    var mangaId = stripTrailingSlash(mangaIdParts[1]);

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
    var allChapters = [];

    listItems.forEach(function(item, index) {
        var itemCtx = ctx + " chapter[" + index + "]";
        var anchor = requireElement(item, "a", itemCtx);
        var mangaChapter = requireText(anchor, itemCtx + " a text");
        var mangaChapterLink = toPrimaryUrl(requireAttr(anchor, "href", itemCtx + " a[href]"));
        var iEl = requireElement(item, "i", itemCtx);
        var mangaPostedTime = extract_Timestamp(requireText(iEl, itemCtx + " i"));
        var chapterId = new PlatformID(PLATFORM, mangaChapter, config.id, PLATFORM_CLAIMTYPE);

        allChapters.push(new PlatformNestedMediaContent({
            id: chapterId, author: author, name: mangaChapter,
            datetime: mangaPostedTime, thumbnails: [], description: "",
            url: mangaChapterLink, images: [],
            contentUrl: mangaChapterLink, contentName: mangaChapter,
            contentDescription: ""
        }));
    });

    // Apply sort: ManhuaFast returns newest-first by default (2)
    if (order === "Oldest First") {
        allChapters.reverse();
    }

    // Client-side pagination of the full chapter list (H)
    var pageItems = allChapters.slice(offset, offset + PAGE_SIZE);
    var hasMore = (offset + PAGE_SIZE) < allChapters.length;

    return new ContentPager(pageItems, hasMore, { offset: offset + PAGE_SIZE });
}

source.isContentDetailsUrl = function(url) { return REGEX_CHAPTER_URL.test(url); }
// Returns true for chapter reader URLs so Grayjay tracks them in watch history

// Chapter images scoped to the reader container first,
// falling back progressively to avoid capturing UI images (D)
source.getContentDetails = function(url) {
    url = toPrimaryUrl(url);
    var ctx = "getContentDetails(" + url + ")";
    var response = requestGET(url);
    var html = response.body.replace(/\s+/g, ' ').trim();
    var doc = parseHTML(html, url);

    var mangaIdParts = url.split('/manga/');
    if (mangaIdParts.length < 2) {
        throw new ScriptException("[ManhuaFast] UNEXPECTED CONTENT URL: no '/manga/' in " + url);
    }
    var pathParts = mangaIdParts[1].split('/').filter(Boolean);
    var mangaSlug   = pathParts[0];
    var chapterSlug = pathParts.length > 1 ? pathParts[1] : pathParts[0];
    var mangaUrl    = BASE_URL_PRIMARY + "/manga/" + mangaSlug + "/";

    // Prefer chapter-reader container; fall back to entry content then all images (D)
    var imgElements = doc.querySelectorAll(".reading-content img");
    if (!imgElements || imgElements.length === 0) {
        imgElements = doc.querySelectorAll(".entry-content img");
    }
    if (!imgElements || imgElements.length === 0) {
        imgElements = doc.querySelectorAll("img");
    }

    if (!imgElements || imgElements.length === 0) {
        throw new ScriptException("[ManhuaFast] NO IMG ELEMENTS FOUND in " + ctx);
    }

    var images = [];
    var thumbnailsArray = [];

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

    var mangaId   = new PlatformID(PLATFORM, mangaSlug,   config.id, PLATFORM_CLAIMTYPE);
    var chapterId = new PlatformID(PLATFORM, chapterSlug, config.id, PLATFORM_CLAIMTYPE);

    return new PlatformNestedMediaContentDetails({
        id: chapterId, name: chapterSlug,
        author: new PlatformAuthorLink(mangaId, mangaSlug, mangaUrl, "", 0, ""),
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
