const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;

// ============================================================
// Providers
//
// Both sites run the WordPress "Madara" theme, so they share the
// same markup (.page-item-detail, .post-title a, li.wp-manga-chapter)
// and the same POST <mangaUrl>/ajax/chapters/ endpoint.
// The order here MUST match the "Provider" dropdown options in
// ManhuaFastConfig.json (dropdown settings arrive as the option index).
// ============================================================

const PROVIDERS = [
  {
    key: "manhuafast",
    name: "ManhuaFast",
    baseUrl: "https://manhuafast.com",
    fallbackUrl: "https://manhuafast.net",
    hosts: ["manhuafast.com", "www.manhuafast.com", "manhuafast.net", "www.manhuafast.net"],
    homePath: "/",
  },
  {
    key: "manhuaus",
    name: "ManhuaUS",
    baseUrl: "https://manhuaus.com",
    fallbackUrl: null,
    hosts: ["manhuaus.com", "www.manhuaus.com"],
    // Madara archive page sorted by latest chapter — same .page-item-detail
    // grid as the front page, but a layout every Madara site guarantees.
    homePath: "/manga/?m_orderby=latest",
  },
];

function allHostsPattern() {
  var hosts = [];
  PROVIDERS.forEach(function (p) {
    p.hosts.forEach(function (h) {
      hosts.push(h.replace(/\./g, "\\."));
    });
  });
  return "(" + hosts.join("|") + ")";
}

// /manga/<slug>/
const REGEX_CHANNEL_URL = new RegExp("^https?:\\/\\/" + allHostsPattern() + "\\/manga\\/([^\\/]+)\\/?$");

// /manga/<slug>/<chapter>/ (+ optional ?query or #hash)
const REGEX_CHAPTER_URL = new RegExp(
  "^https?:\\/\\/" + allHostsPattern() + "\\/manga\\/[^\\/]+\\/[^\\/]+\\/?(?:[?#].*)?$"
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

var _activeProvider = PROVIDERS[0];

function getActiveProvider() {
  return _activeProvider || PROVIDERS[0];
}

// Resolve which provider a URL belongs to (by host), regardless of the
// currently selected provider — so subscriptions to either site keep
// working after switching the dropdown.
function getProviderForUrl(url) {
  if (!url) return null;
  for (var i = 0; i < PROVIDERS.length; i++) {
    var p = PROVIDERS[i];
    for (var j = 0; j < p.hosts.length; j++) {
      var h = p.hosts[j];
      if (url.indexOf("https://" + h + "/") === 0 || url === "https://" + h ||
          url.indexOf("http://" + h + "/") === 0 || url === "http://" + h) {
        return p;
      }
    }
  }
  return null;
}

// ============================================================
// HTTP (primary -> fallback, per provider)
// ============================================================

function getFallbackUrl(url, provider) {
  if (provider && provider.fallbackUrl && url && url.indexOf(provider.baseUrl) === 0) {
    return url.replace(provider.baseUrl, provider.fallbackUrl);
  }
  return null;
}

function isUsableResponse(response) {
  if (!response) return false;
  if (typeof response.code === "number" && response.code >= 400) return false;
  if (!response.body || response.body.trim().length === 0) return false;
  return true;
}

function refererFor(url, provider) {
  if (provider && provider.fallbackUrl && url.indexOf(provider.fallbackUrl) === 0) {
    return provider.fallbackUrl + "/";
  }
  return (provider ? provider.baseUrl : getActiveProvider().baseUrl) + "/";
}

function requestGET(url, extraHeaders) {
  var provider = getProviderForUrl(url) || getActiveProvider();
  var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
  headers["Referer"] = refererFor(url, provider);

  var response = null;

  try {
    response = http.GET(url, headers, false);
  } catch (e) {
    response = null;
  }

  if (isUsableResponse(response)) return response;

  var fallbackUrl = getFallbackUrl(url, provider);
  if (!fallbackUrl) {
    throw new ScriptException(
      "[" + provider.name + "] HTTP GET FAILED for " +
        url +
        " — HTTP " +
        (response ? response.code : "null/error")
    );
  }

  console.log("[" + provider.name + "] Primary request failed for " + url + " — trying fallback: " + fallbackUrl);
  headers["Referer"] = refererFor(fallbackUrl, provider);

  try {
    response = http.GET(fallbackUrl, headers, false);
  } catch (e) {
    throw new ScriptException(
      "[" + provider.name + "] HTTP GET FAILED for both " +
        url +
        " and " +
        fallbackUrl +
        ": " +
        (e && e.message ? e.message : e)
    );
  }

  if (isUsableResponse(response)) return response;

  throw new ScriptException(
    "[" + provider.name + "] HTTP GET FAILED for both " +
      url +
      " (primary) and " +
      fallbackUrl +
      " (fallback). Last HTTP code: " +
      (response ? response.code : "null")
  );
}

function requestPOST(url, postBody, extraHeaders) {
  var provider = getProviderForUrl(url) || getActiveProvider();
  var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
  headers["Referer"] = refererFor(url, provider);

  var response = null;

  try {
    response = http.POST(url, postBody || "", headers, false);
  } catch (e) {
    response = null;
  }

  if (isUsableResponse(response)) return response;

  var fallbackUrl = getFallbackUrl(url, provider);
  if (!fallbackUrl) {
    throw new ScriptException(
      "[" + provider.name + "] HTTP POST FAILED for " +
        url +
        " — HTTP " +
        (response ? response.code : "null/error")
    );
  }

  console.log("[" + provider.name + "] Primary POST failed for " + url + " — trying fallback: " + fallbackUrl);
  headers["Referer"] = refererFor(fallbackUrl, provider);

  try {
    response = http.POST(fallbackUrl, postBody || "", headers, false);
  } catch (e) {
    throw new ScriptException(
      "[" + provider.name + "] HTTP POST FAILED for both " +
        url +
        " and " +
        fallbackUrl +
        ": " +
        (e && e.message ? e.message : e)
    );
  }

  if (isUsableResponse(response)) return response;

  throw new ScriptException(
    "[" + provider.name + "] HTTP POST FAILED for both " +
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
    throw new ScriptException("[" + PLATFORM + "] CANNOT PARSE: received empty/null HTML from " + url);
  }
  var doc = domParser.parseFromString(html, "text/html");
  if (!doc) throw new ScriptException("[" + PLATFORM + "] DOM PARSE RETURNED NULL for " + url);
  return doc;
}

function requireElement(parent, selector, context) {
  if (!parent) throw new ScriptException("[" + PLATFORM + "] PARENT NULL for selector '" + selector + "' in " + context);
  var el = parent.querySelector(selector);
  if (!el) throw new ScriptException("[" + PLATFORM + "] ELEMENT NOT FOUND: '" + selector + "' in " + context);
  return el;
}

function requireElements(parent, selector, context) {
  if (!parent) throw new ScriptException("[" + PLATFORM + "] PARENT NULL for selector '" + selector + "' in " + context);
  var els = parent.querySelectorAll(selector);
  if (!els || els.length === 0) throw new ScriptException("[" + PLATFORM + "] NO ELEMENTS FOUND: '" + selector + "' in " + context);
  return els;
}

// First element matching any selector in the list, or null.
function firstElement(parent, selectors) {
  if (!parent) return null;
  for (var i = 0; i < selectors.length; i++) {
    var el = parent.querySelector(selectors[i]);
    if (el) return el;
  }
  return null;
}

function requireText(element, context) {
  if (!element) throw new ScriptException("[" + PLATFORM + "] NULL ELEMENT reading textContent in " + context);
  var text = element.textContent;
  if (text === null || text === undefined) {
    throw new ScriptException("[" + PLATFORM + "] textContent NULL/UNDEFINED in " + context);
  }
  return String(text).trim();
}

function requireAttr(element, attr, context) {
  if (!element) throw new ScriptException("[" + PLATFORM + "] NULL ELEMENT reading attr '" + attr + "' in " + context);
  var val = element.getAttribute(attr);
  if (!val) throw new ScriptException("[" + PLATFORM + "] ATTRIBUTE '" + attr + "' MISSING/EMPTY in " + context);
  return String(val).trim();
}

// Madara lazy-loads images via data-src, data-lazy-src or srcset
// depending on the site's lazy-load plugin.
function requireImageSrc(imgElement, context) {
  if (!imgElement) throw new ScriptException("[" + PLATFORM + "] NULL IMG in " + context);

  var dataSrc = imgElement.getAttribute("data-src");
  if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();

  var dataLazy = imgElement.getAttribute("data-lazy-src");
  if (dataLazy && dataLazy.trim().length > 0) return dataLazy.trim();

  var srcset = imgElement.getAttribute("srcset");
  if (srcset && srcset.trim().length > 0) {
    // "url1 100w, url2 200w" -> first URL
    var first = srcset.trim().split(",")[0].trim().split(/\s+/)[0];
    if (first && first.length > 0) return first;
  }

  var src = imgElement.getAttribute("src");
  if (src && src.trim().length > 0) return src.trim();

  throw new ScriptException("[" + PLATFORM + "] IMG HAS NO data-src/data-lazy-src/srcset/src in " + context);
}

// Normalize any known host (www./fallback domain) to that provider's
// canonical baseUrl so IDs stay stable.
function normalizeUrl(url) {
  if (!url) return url;
  for (var i = 0; i < PROVIDERS.length; i++) {
    var p = PROVIDERS[i];
    for (var j = 0; j < p.hosts.length; j++) {
      var origin = "https://" + p.hosts[j];
      if (url.indexOf(origin + "/") === 0 || url === origin) {
        return p.baseUrl + url.substring(origin.length);
      }
      var originHttp = "http://" + p.hosts[j];
      if (url.indexOf(originHttp + "/") === 0 || url === originHttp) {
        return p.baseUrl + url.substring(originHttp.length);
      }
    }
  }
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

  // Fallback: parse date-ish strings if present (e.g. "July 27, 2026")
  var date = new Date(str);
  if (!isNaN(date.getTime())) return Math.floor(date.getTime() / 1000);

  return 0;
}

// ============================================================
// Lifecycle
// ============================================================

source.enable = function (conf, settings, savedState) {
  source.config = conf;
  config.id = conf && conf.id ? conf.id : config.id;

  var idx = 0;
  if (settings && settings.provider !== undefined && settings.provider !== null) {
    idx = parseInt(settings.provider);
    if (isNaN(idx) || idx < 0 || idx >= PROVIDERS.length) idx = 0;
  }
  _activeProvider = PROVIDERS[idx];

  console.log("[" + PLATFORM + "] Plugin enabled — provider: " + _activeProvider.name + " (" + _activeProvider.baseUrl + ")");
};

// ============================================================
// Home (source home feed)
// ============================================================

source.getHome = function (continuationToken) {
  var provider = getActiveProvider();
  var homeUrl = provider.baseUrl + provider.homePath;
  var response = requestGET(homeUrl);
  var doc = parseHTML(response.body, homeUrl);

  var items = requireElements(doc, ".page-item-detail", "getHome(" + homeUrl + ")");
  var posts = [];

  items.forEach(function (item, index) {
    var ctx = "getHome item[" + index + "]";

    // Skip items that don't have the full expected markup (e.g. a manga
    // with no chapters yet) instead of failing the whole home feed.
    var mangaAnchor = item.querySelector(".post-title a");
    var chapterAnchor = item.querySelector(".chapter-item .chapter a") || item.querySelector(".list-chapter .chapter a");
    var imgEl = item.querySelector("img");

    if (!mangaAnchor || !chapterAnchor || !imgEl) {
      console.log("[" + provider.name + "] " + ctx + " missing title/chapter/img — skipping");
      return;
    }

    var mangaTitle = requireText(mangaAnchor, ctx + " .post-title a");
    var mangaUrl = normalizeUrl(requireAttr(mangaAnchor, "href", ctx + " manga href"));

    var chapterName = requireText(chapterAnchor, ctx + " chapter text");
    var chapterUrl = normalizeUrl(requireAttr(chapterAnchor, "href", ctx + " chapter href"));

    var postOnEl = item.querySelector(".post-on");
    var postedTime = postOnEl ? extract_Timestamp(requireText(postOnEl, ctx + " .post-on")) : 0;

    var thumbUrl = requireImageSrc(imgEl, ctx + " img");

    var mangaIdParts = mangaUrl.split("/manga/");
    if (mangaIdParts.length < 2) throw new ScriptException("[" + PLATFORM + "] UNEXPECTED MANGA URL: " + mangaUrl);

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
  var provider = getActiveProvider();
  var searchUrl = provider.baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
  var response = requestGET(searchUrl);
  var doc = parseHTML(response.body, searchUrl);

  var anchors = doc.querySelectorAll(".post-title a");
  var channels = [];

  if (!anchors || anchors.length === 0) {
    return new ChannelPager([], false, { query: query, continuationToken: continuationToken });
  }

  anchors.forEach(function (a, index) {
    var ctx = "searchChannels[" + index + "]";

    var url = normalizeUrl(requireAttr(a, "href", ctx + " href"));
    var name = requireText(a, ctx + " text");

    var parts = url.split("/manga/");
    if (parts.length < 2) throw new ScriptException("[" + PLATFORM + "] UNEXPECTED SEARCH RESULT URL: " + url);

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
  url = normalizeUrl(asUrl(url));
  var ctx = "getChannel(" + url + ")";

  var response = requestGET(url);
  var doc = parseHTML(response.body, url);

  // Madara puts the manga title in .post-title as either h1 or h3
  var titleEl = firstElement(doc, [".post-title h1", ".post-title h3", "h1"]);
  if (!titleEl) throw new ScriptException("[" + PLATFORM + "] TITLE NOT FOUND in " + ctx);
  var name = requireText(titleEl, ctx + " title");

  var img = firstElement(doc, [".summary_image img", ".tab-summary img"]);
  var thumb = img ? requireImageSrc(img, ctx + " summary img") : "";

  var parts = url.split("/manga/");
  if (parts.length < 2) throw new ScriptException("[" + PLATFORM + "] UNEXPECTED CHANNEL URL: " + url);

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
  url = normalizeUrl(asUrl(url));
  var ctx = "getChannelContents(" + url + ")";

  var getResponse = requestGET(url);
  var getDoc = parseHTML(getResponse.body, url);

  var titleEl = firstElement(getDoc, [".post-title h1", ".post-title h3", "h1"]);
  if (!titleEl) throw new ScriptException("[" + PLATFORM + "] TITLE NOT FOUND in " + ctx);
  var mangaTitle = requireText(titleEl, ctx + " title");

  var summaryImg = firstElement(getDoc, [".summary_image img", ".tab-summary img"]);
  var mangaThumb = summaryImg ? requireImageSrc(summaryImg, ctx + " summary img") : "";

  var parts = url.split("/manga/");
  if (parts.length < 2) throw new ScriptException("[" + PLATFORM + "] UNEXPECTED CHANNEL URL: " + url);

  var authorId = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);
  var author = new PlatformAuthorLink(authorId, mangaTitle, url, mangaThumb, 0, "");

  // Madara chapters endpoint (same on both providers)
  var chapterApiUrl = url + (url.endsWith("/") ? "" : "/") + "ajax/chapters/";
  var postResponse = requestPOST(chapterApiUrl, "");
  var postDoc = parseHTML(postResponse.body, chapterApiUrl);

  // Prefer the specific Madara chapter row class; fall back to bare <li>
  var listItems = postDoc.querySelectorAll("li.wp-manga-chapter");
  if (!listItems || listItems.length === 0) {
    listItems = requireElements(postDoc, "li", ctx + " chapters");
  }
  var posts = [];

  listItems.forEach(function (li, index) {
    var itemCtx = ctx + " chapter[" + index + "]";

    var a = li.querySelector("a");
    if (!a) {
      console.log("[" + PLATFORM + "] " + itemCtx + " has no <a> — skipping");
      return;
    }
    var chapterName = requireText(a, itemCtx + " a text");
    var chapterLink = normalizeUrl(requireAttr(a, "href", itemCtx + " a href"));

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
  log("isContentDetailsUrl");
  // Any URL on a known provider host (was: always true)
  return getProviderForUrl(normalizeUrl(asUrl(url))) !== null;
};

source.getContentDetails = function (url) {
  // Grayjay may pass a string URL or a PlatformID
  log("getContenDetails");
  url = normalizeUrl(asUrl(url));

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
