const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;

const BASE_URL_PRIMARY = "https://manhuafast.com";
const BASE_URL_FALLBACK = "https://manhuafast.net";

// /manga/<slug>/
const REGEX_CHANNEL_URL = new RegExp("^https:\\/\\/manhuafast\\.(com|net)\\/manga\\/([^\\/]+)\\/?$");

// /manga/<slug>/<chapter>/ (+ optional ?query or #hash)
const REGEX_CHAPTER_URL = new RegExp(
  "^https:\\/\\/manhuafast\\.(com|net)\\/manga\\/[^\\/]+\\/[^\\/]+\\/?(?:[?#].*)?$"
);

const REGEX_HUMAN_AGO = new RegExp(
  "([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago"
);

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

const ORDER_OLDEST = "oldest";

const config = {
  id: undefined, // plugin id
};

// ============================================================
// HTTP (primary -> fallback)
// ============================================================

function getFallbackUrl(url) {
  if (url && url.indexOf(BASE_URL_PRIMARY) === 0) {
    return url.replace(BASE_URL_PRIMARY, BASE_URL_FALLBACK);
  }
  return null;
}

function isUsableResponse(response) {
  if (!response) return false;
  if (typeof response.code === "number" && response.code >= 400) return false;
  if (!response.body || response.body.trim().length === 0) return false;
  return true;
}

function requestGET(url, extraHeaders) {
  var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
  headers["Referer"] =
    url.indexOf(BASE_URL_FALLBACK) === 0 ? BASE_URL_FALLBACK + "/" : BASE_URL_PRIMARY + "/";

  var response = null;

  try {
    response = http.GET(url, headers, false);
  } catch (e) {
    response = null;
  }

  if (isUsableResponse(response)) return response;

  var fallbackUrl = getFallbackUrl(url);
  if (!fallbackUrl) {
    throw new ScriptException(
      "[ManhuaFast] HTTP GET FAILED for " +
        url +
        " — HTTP " +
        (response ? response.code : "null/error")
    );
  }

  console.log("[ManhuaFast] Primary request failed for " + url + " — trying fallback: " + fallbackUrl);
  headers["Referer"] = BASE_URL_FALLBACK + "/";

  try {
    response = http.GET(fallbackUrl, headers, false);
  } catch (e) {
    throw new ScriptException(
      "[ManhuaFast] HTTP GET FAILED for both " +
        url +
        " and " +
        fallbackUrl +
        ": " +
        (e && e.message ? e.message : e)
    );
  }

  if (isUsableResponse(response)) return response;

  throw new ScriptException(
    "[ManhuaFast] HTTP GET FAILED for both " +
      url +
      " (primary) and " +
      fallbackUrl +
      " (fallback). Last HTTP code: " +
      (response ? response.code : "null")
  );
}

function requestPOST(url, postBody, extraHeaders) {
  var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
  headers["Referer"] =
    url.indexOf(BASE_URL_FALLBACK) === 0 ? BASE_URL_FALLBACK + "/" : BASE_URL_PRIMARY + "/";

  var response = null;

  try {
    response = http.POST(url, postBody || "", headers, false);
  } catch (e) {
    response = null;
  }

  if (isUsableResponse(response)) return response;

  var fallbackUrl = getFallbackUrl(url);
  if (!fallbackUrl) {
    throw new ScriptException(
      "[ManhuaFast] HTTP POST FAILED for " +
        url +
        " — HTTP " +
        (response ? response.code : "null/error")
    );
  }

  console.log("[ManhuaFast] Primary POST failed for " + url + " — trying fallback: " + fallbackUrl);
  headers["Referer"] = BASE_URL_FALLBACK + "/";

  try {
    response = http.POST(fallbackUrl, postBody || "", headers, false);
  } catch (e) {
    throw new ScriptException(
      "[ManhuaFast] HTTP POST FAILED for both " +
        url +
        " and " +
        fallbackUrl +
        ": " +
        (e && e.message ? e.message : e)
    );
  }

  if (isUsableResponse(response)) return response;

  throw new ScriptException(
    "[ManhuaFast] HTTP POST FAILED for both " +
      url +
      " (primary) and " +
      fallbackUrl +
      " (fallback). Last HTTP code: " +
      (response ? response.code : "null")
  );
}

// ============================================================
// DOM helpers
// ============================================================

function parseHTML(html, url) {
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    throw new ScriptException("[ManhuaFast] CANNOT PARSE: received empty/null HTML from " + url);
  }
  var doc = domParser.parseFromString(html, "text/html");
  if (!doc) throw new ScriptException("[ManhuaFast] DOM PARSE RETURNED NULL for " + url);
  return doc;
}

function requireElement(parent, selector, context) {
  if (!parent) throw new ScriptException("[ManhuaFast] PARENT NULL for selector '" + selector + "' in " + context);
  var el = parent.querySelector(selector);
  if (!el) throw new ScriptException("[ManhuaFast] ELEMENT NOT FOUND: '" + selector + "' in " + context);
  return el;
}

function requireElements(parent, selector, context) {
  if (!parent) throw new ScriptException("[ManhuaFast] PARENT NULL for selector '" + selector + "' in " + context);
  var els = parent.querySelectorAll(selector);
  if (!els || els.length === 0) throw new ScriptException("[ManhuaFast] NO ELEMENTS FOUND: '" + selector + "' in " + context);
  return els;
}

function requireText(element, context) {
  if (!element) throw new ScriptException("[ManhuaFast] NULL ELEMENT reading textContent in " + context);
  var text = element.textContent;
  if (text === null || text === undefined) {
    throw new ScriptException("[ManhuaFast] textContent NULL/UNDEFINED in " + context);
  }
  return String(text).trim();
}

function requireAttr(element, attr, context) {
  if (!element) throw new ScriptException("[ManhuaFast] NULL ELEMENT reading attr '" + attr + "' in " + context);
  var val = element.getAttribute(attr);
  if (!val) throw new ScriptException("[ManhuaFast] ATTRIBUTE '" + attr + "' MISSING/EMPTY in " + context);
  return String(val).trim();
}

function requireImageSrc(imgElement, context) {
  if (!imgElement) throw new ScriptException("[ManhuaFast] NULL IMG in " + context);

  var dataSrc = imgElement.getAttribute("data-src");
  if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();

  var src = imgElement.getAttribute("src");
  if (src && src.trim().length > 0) return src.trim();

  throw new ScriptException("[ManhuaFast] IMG HAS NO data-src OR src in " + context);
}

function toPrimaryUrl(url) {
  if (!url) return url;
  if (url.indexOf(BASE_URL_FALLBACK) === 0) return url.replace(BASE_URL_FALLBACK, BASE_URL_PRIMARY);
  return url;
}

// Accept string URL, PlatformID, or content object
function asUrl(u) {
  if (!u) return "";
  if (typeof u === "string") return u;
  if (typeof u === "object" && typeof u.value === "string") return u.value; // PlatformID
  if (typeof u === "object" && typeof u.url === "string") return u.url; // content object
  return String(u);
}

// ============================================================
// Timestamp parsing
// ============================================================

function extract_Timestamp(str) {
  if (!str) return 0;

  var match = str.match(REGEX_HUMAN_AGO);
  if (match) {
    var value = parseInt(match[1]);
    if (isNaN(value)) return 0;

    var now = Math.floor(new Date().getTime() / 1000);

    switch (match[2]) {
      case "second":
      case "seconds":
        return now - value;
      case "min":
      case "mins":
        return now - value * 60;
      case "hour":
      case "hours":
        return now - value * 3600;
      case "day":
      case "days":
        return now - value * 86400;
      case "week":
      case "weeks":
        return now - value * 604800;
      case "month":
      case "months":
        return now - value * 2592000;
      case "year":
      case "years":
        return now - value * 31536000;
      default:
        return 0;
    }
  }

  // Fallback: parse date-ish strings if present
  var date = new Date(str);
  if (!isNaN(date.getTime())) return Math.floor(date.getTime() / 1000);

  return 0;
}

// ============================================================
// Lifecycle
// ============================================================

source.enable = function (conf) {
  source.config = conf;
  config.id = conf && conf.id ? conf.id : config.id;
  console.log("[ManhuaFast] Plugin enabled");
};

// ============================================================
// Home (source home feed)
// ============================================================

source.getHome = function (continuationToken) {
  var homeUrl = BASE_URL_PRIMARY + "/";
  var response = requestGET(homeUrl);
  var doc = parseHTML(response.body, homeUrl);

  var items = requireElements(doc, ".page-item-detail", "getHome(" + homeUrl + ")");
  var posts = [];

  items.forEach(function (item, index) {
    var ctx = "getHome item[" + index + "]";

    var mangaAnchor = requireElement(item, ".post-title a", ctx);
    var chapterAnchor = requireElement(item, ".chapter-item .chapter a", ctx);

    var mangaTitle = requireText(mangaAnchor, ctx + " .post-title a");
    var mangaUrl = toPrimaryUrl(requireAttr(mangaAnchor, "href", ctx + " manga href"));

    var chapterName = requireText(chapterAnchor, ctx + " chapter text");
    var chapterUrl = toPrimaryUrl(requireAttr(chapterAnchor, "href", ctx + " chapter href"));

    var postOnEl = requireElement(item, ".post-on", ctx);
    var postedTime = extract_Timestamp(requireText(postOnEl, ctx + " .post-on"));

    var imgEl = requireElement(item, "img", ctx);
    var thumbUrl = requireImageSrc(imgEl, ctx + " img");

    var mangaIdParts = mangaUrl.split("/manga/");
    if (mangaIdParts.length < 2) throw new ScriptException("[ManhuaFast] UNEXPECTED MANGA URL: " + mangaUrl);

    var authorId = new PlatformID(PLATFORM, mangaIdParts[1], config.id, PLATFORM_CLAIMTYPE);
    var author = new PlatformAuthorLink(authorId, mangaTitle, mangaUrl, thumbUrl, 0, "");

    // Stable unique ID = chapter URL
    var postId = new PlatformID(PLATFORM, chapterUrl, config.id, PLATFORM_CLAIMTYPE);

    posts.push(
      new PlatformWeb({
        id: postId,
        author: author,
        name: chapterName,
        datetime: postedTime,
        url: chapterUrl,
        thumbnails: new Thumbnails([new Thumbnail(thumbUrl, 0)]),
      })
    );
  });

  return new ContentPager(posts, false, { continuationToken: continuationToken });
};

// ============================================================
// Search (channels only; content search not implemented)
// ============================================================

source.searchSuggestions = function (query) {
  return [];
};

source.getSearchCapabilities = function () {
  return {
    types: [Type.Feed.Mixed],
    sorts: [Type.Order.Chronological],
    filters: [],
  };
};

source.search = function (query, type, order, filters, continuationToken) {
  return new ContentPager([], false, {
    query: query,
    type: type,
    order: order,
    filters: filters,
    continuationToken: continuationToken,
  });
};

// ============================================================
// Channel search
// ============================================================

source.searchChannels = function (query, continuationToken) {
  var searchUrl = BASE_URL_PRIMARY + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
  var response = requestGET(searchUrl);
  var doc = parseHTML(response.body, searchUrl);

  var anchors = doc.querySelectorAll(".post-title a");
  var channels = [];

  if (!anchors || anchors.length === 0) {
    return new ChannelPager([], false, { query: query, continuationToken: continuationToken });
  }

  anchors.forEach(function (a, index) {
    var ctx = "searchChannels[" + index + "]";

    var url = toPrimaryUrl(requireAttr(a, "href", ctx + " href"));
    var name = requireText(a, ctx + " text");

    var parts = url.split("/manga/");
    if (parts.length < 2) throw new ScriptException("[ManhuaFast] UNEXPECTED SEARCH RESULT URL: " + url);

    var id = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);

    channels.push(
      new PlatformChannel({
        id: id,
        name: name,
        thumbnail: "",
        banner: "",
        subscribers: 0,
        description: "",
        url: url,
        urlAlternatives: [],
        links: {},
      })
    );
  });

  return new ChannelPager(channels, false, { query: query, continuationToken: continuationToken });
};

// ============================================================
// Channel methods
// ============================================================

source.isChannelUrl = function (url) {
  return REGEX_CHANNEL_URL.test(asUrl(url));
};

source.getChannel = function (url) {
  url = toPrimaryUrl(asUrl(url));
  var ctx = "getChannel(" + url + ")";

  var response = requestGET(url);
  var doc = parseHTML(response.body, url);

  var h1 = requireElement(doc, "h1", ctx);
  var name = requireText(h1, ctx + " h1");

  var img = doc.querySelector(".tab-summary img") || doc.querySelector(".summary_image img");
  var thumb = img ? requireImageSrc(img, ctx + " summary img") : "";

  var parts = url.split("/manga/");
  if (parts.length < 2) throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: " + url);

  var id = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);

  return new PlatformChannel({
    id: id,
    name: name,
    thumbnail: thumb,
    banner: "",
    subscribers: 0,
    description: "",
    url: url,
    urlAlternatives: [],
    links: {},
  });
};

source.getChannelCapabilities = function () {
  return {
    types: [Type.Feed.Mixed],
    sorts: [Type.Order.Chronological, ORDER_OLDEST],
    filters: [],
  };
};

// ============================================================
// Channel contents (chapters) -> PlatformWeb
// ============================================================

source.getChannelContents = function (url, type, order, filters, continuationToken) {
  url = toPrimaryUrl(asUrl(url));
  var ctx = "getChannelContents(" + url + ")";

  var getResponse = requestGET(url);
  var getDoc = parseHTML(getResponse.body, url);

  var h1 = requireElement(getDoc, "h1", ctx);
  var mangaTitle = requireText(h1, ctx + " h1");

  var summaryImg = getDoc.querySelector(".summary_image img") || getDoc.querySelector(".tab-summary img");
  var mangaThumb = summaryImg ? requireImageSrc(summaryImg, ctx + " summary img") : "";

  var parts = url.split("/manga/");
  if (parts.length < 2) throw new ScriptException("[ManhuaFast] UNEXPECTED CHANNEL URL: " + url);

  var authorId = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);
  var author = new PlatformAuthorLink(authorId, mangaTitle, url, mangaThumb, 0, "");

  // Madara chapters endpoint
  var chapterApiUrl = url + (url.endsWith("/") ? "" : "/") + "ajax/chapters/";
  var postResponse = requestPOST(chapterApiUrl, "");
  var postDoc = parseHTML(postResponse.body, chapterApiUrl);

  var listItems = requireElements(postDoc, "li", ctx + " chapters");
  var posts = [];

  listItems.forEach(function (li, index) {
    var itemCtx = ctx + " chapter[" + index + "]";

    var a = requireElement(li, "a", itemCtx);
    var chapterName = requireText(a, itemCtx + " a text");
    var chapterLink = toPrimaryUrl(requireAttr(a, "href", itemCtx + " a href"));

    var iEl = li.querySelector("i");
    var postedTime = iEl ? extract_Timestamp(requireText(iEl, itemCtx + " i")) : 0;

    var postId = new PlatformID(PLATFORM, chapterLink, config.id, PLATFORM_CLAIMTYPE);

    posts.push(
      new PlatformWeb({
        id: postId,
        author: author,
        name: chapterName,
        datetime: postedTime,
        url: chapterLink,
        thumbnails: new Thumbnails([new Thumbnail(mangaThumb, 0)]),
      })
    );
  });

  if (order === ORDER_OLDEST) posts.reverse();

  return new ContentPager(posts, false, {
    continuationToken: continuationToken,
    order: order,
  });
};

// ============================================================
// Content details -> PlatformWebDetails (URL-based, no html override)
// ============================================================

source.isContentDetailsUrl = function (url) {
  return REGEX_CHAPTER_URL.test(asUrl(url));
};

source.getContentDetails = function (url) {
  // Grayjay may pass a string URL or a PlatformID
  url = toPrimaryUrl(asUrl(url));

  // Optional fetch for title only (and to fail early with a clearer error if chapter is unreachable)
  var response = requestGET(url);

  var title = url;
  try {
    var doc = parseHTML(response.body, url);
    var h1 = doc.querySelector("h1");
    if (h1) title = (h1.textContent || "").trim() || title;
  } catch (e) {
    // keep URL fallback title
  }

  var id = new PlatformID(PLATFORM, url, config.id, PLATFORM_CLAIMTYPE);

  // IMPORTANT: Do NOT set html if you want Grayjay to load the URL itself in the in-app browser
  return new PlatformWebDetails({
    id: id,
    name: title,
    url: url,
  });
};

// ============================================================
// Comments (not supported)
// ============================================================

source.getComments = function (url, continuationToken) {
  return [];
};
