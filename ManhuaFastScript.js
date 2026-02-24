const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;

const BASE_URL_PRIMARY = "https://manhuafast.net";
const BASE_URL_FALLBACK = "https://manhuafast.com";

const REGEX_CHANNEL_URL = /^https:\/\/manhuafast\.(com|net)\/manga\/([^\/]+)\/?$/;
const REGEX_HUMAN_AGO = /([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago/;

const config = {};

function logContentItem(prefix, item) {
  try {
    var pid = item && item.id ? item.id : null;
    var idValue = pid && pid.value ? pid.value : "(no id.value)";
    var ptype = item && item.plugin_type ? item.plugin_type : "(no plugin_type)";
    var ctype = (item && item.contentType !== undefined) ? item.contentType : "(no contentType)";
    log(prefix + " plugin_type=" + ptype + " contentType=" + ctype + " id=" + idValue + " url=" + (item ? item.url : ""));
  } catch (e) {
    log(prefix + " (failed to inspect item): " + e);
  }
}

// ===========================
// HTTP
// ===========================

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
  var headers = Object.assign({}, extraHeaders || {});
  headers["Referer"] = url.indexOf(BASE_URL_FALLBACK) === 0 ? BASE_URL_FALLBACK + "/" : BASE_URL_PRIMARY + "/";

  log("HTTP GET -> " + url);
  var response = null;

  try {
    response = http.GET(url, headers, false);
    log("HTTP GET primary code=" + (response ? response.code : "null") + " bodyLen=" + (response && response.body ? response.body.length : 0));
  } catch (e) {
    log("HTTP GET primary exception: " + (e && e.message ? e.message : e));
    response = null;
  }

  if (isUsableResponse(response)) return response;

  var fallbackUrl = getFallbackUrl(url);
  if (!fallbackUrl) {
    throw new ScriptException("[ManhuaFast] HTTP GET FAILED for " + url + " — HTTP " + (response ? response.code : "null/error"));
  }

  log("HTTP GET trying fallback -> " + fallbackUrl);
  headers["Referer"] = BASE_URL_FALLBACK + "/";

  try {
    response = http.GET(fallbackUrl, headers, false);
    log("HTTP GET fallback code=" + (response ? response.code : "null") + " bodyLen=" + (response && response.body ? response.body.length : 0));
  } catch (e) {
    throw new ScriptException("[ManhuaFast] HTTP GET FAILED for both " + url + " and " + fallbackUrl + ": " + (e && e.message ? e.message : e));
  }

  if (isUsableResponse(response)) return response;

  throw new ScriptException("[ManhuaFast] HTTP GET FAILED for both " + url + " and " + fallbackUrl + ". Last HTTP code: " + (response ? response.code : "null"));
}

function requestPOST(url, postBody, extraHeaders) {
  var headers = Object.assign({}, extraHeaders || {});
  headers["Referer"] = url.indexOf(BASE_URL_FALLBACK) === 0 ? BASE_URL_FALLBACK + "/" : BASE_URL_PRIMARY + "/";

  log("HTTP POST -> " + url + " bodyLen=" + ((postBody || "").length));
  var response = null;

  try {
    response = http.POST(url, postBody || "", headers, false);
    log("HTTP POST primary code=" + (response ? response.code : "null") + " bodyLen=" + (response && response.body ? response.body.length : 0));
  } catch (e) {
    log("HTTP POST primary exception: " + (e && e.message ? e.message : e));
    response = null;
  }

  if (isUsableResponse(response)) return response;

  var fallbackUrl = getFallbackUrl(url);
  if (!fallbackUrl) {
    throw new ScriptException("[ManhuaFast] HTTP POST FAILED for " + url + " — HTTP " + (response ? response.code : "null/error"));
  }

  log("HTTP POST trying fallback -> " + fallbackUrl);
  headers["Referer"] = BASE_URL_FALLBACK + "/";

  try {
    response = http.POST(fallbackUrl, postBody || "", headers, false);
    log("HTTP POST fallback code=" + (response ? response.code : "null") + " bodyLen=" + (response && response.body ? response.body.length : 0));
  } catch (e) {
    throw new ScriptException("[ManhuaFast] HTTP POST FAILED for both " + url + " and " + fallbackUrl + ": " + (e && e.message ? e.message : e));
  }

  if (isUsableResponse(response)) return response;

  throw new ScriptException("[ManhuaFast] HTTP POST FAILED for both " + url + " and " + fallbackUrl + ". Last HTTP code: " + (response ? response.code : "null"));
}

// ===========================
// DOM helpers
// ===========================

function parseHTML(html, url) {
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    throw new ScriptException("[ManhuaFast] CANNOT PARSE: empty/null HTML from " + url);
  }
  var doc = domParser.parseFromString(html, "text/html");
  if (!doc) throw new ScriptException("[ManhuaFast] DOM PARSE RETURNED NULL for " + url);
  return doc;
}

function requireElement(parent, selector, context) {
  if (!parent) throw new ScriptException("[ManhuaFast] PARENT NULL for '" + selector + "' in " + context);
  var el = parent.querySelector(selector);
  if (!el) throw new ScriptException("[ManhuaFast] ELEMENT NOT FOUND '" + selector + "' in " + context);
  return el;
}

function requireElements(parent, selector, context) {
  if (!parent) throw new ScriptException("[ManhuaFast] PARENT NULL for '" + selector + "' in " + context);
  var els = parent.querySelectorAll(selector);
  if (!els || els.length === 0) throw new ScriptException("[ManhuaFast] NO ELEMENTS '" + selector + "' in " + context);
  return els;
}

function requireText(element, context) {
  if (!element) throw new ScriptException("[ManhuaFast] NULL ELEMENT textContent in " + context);
  var text = element.textContent;
  if (text === null || text === undefined) throw new ScriptException("[ManhuaFast] textContent null in " + context);
  return String(text).trim();
}

function requireAttr(element, attr, context) {
  if (!element) throw new ScriptException("[ManhuaFast] NULL ELEMENT attr '" + attr + "' in " + context);
  var val = element.getAttribute(attr);
  if (!val) throw new ScriptException("[ManhuaFast] ATTRIBUTE '" + attr + "' missing in " + context);
  return String(val).trim();
}

function requireImageSrc(imgElement, context) {
  if (!imgElement) throw new ScriptException("[ManhuaFast] NULL IMG in " + context);
  var dataSrc = imgElement.getAttribute("data-src");
  if (dataSrc && dataSrc.trim().length > 0) return dataSrc.trim();
  var src = imgElement.getAttribute("src");
  if (src && src.trim().length > 0) return src.trim();
  throw new ScriptException("[ManhuaFast] IMG HAS NO data-src/src in " + context);
}

function toPrimaryUrl(url) {
  if (!url) return url;
  if (typeof url !== "string") return url;
  if (url.indexOf(BASE_URL_FALLBACK) === 0) return url.replace(BASE_URL_FALLBACK, BASE_URL_PRIMARY);
  return url;
}

function asUrl(u) {
  if (!u) return "";
  if (typeof u === "string") return u;
  if (typeof u === "object" && typeof u.value === "string") return u.value; // PlatformID
  if (typeof u === "object" && typeof u.url === "string") return u.url;     // content object
  return String(u);
}

// ===========================
// Time parsing
// ===========================

function extractTimestamp(str) {
  if (!str) return 0;

  var match = str.match(REGEX_HUMAN_AGO);
  if (match) {
    var value = parseInt(match[1]);
    if (isNaN(value)) return 0;

    var now = Math.floor(new Date().getTime() / 1000);

    switch (match[2]) {
      case "second":
      case "seconds": return now - value;
      case "min":
      case "mins":    return now - value * 60;
      case "hour":
      case "hours":   return now - value * 3600;
      case "day":
      case "days":    return now - value * 86400;
      case "week":
      case "weeks":   return now - value * 604800;
      case "month":
      case "months":  return now - value * 2592000;
      case "year":
      case "years":   return now - value * 31536000;
    }
  }

  var date = new Date(str);
  if (!isNaN(date.getTime())) return Math.floor(date.getTime() / 1000);
  return 0;
}

// ===========================
// Lifecycle
// ===========================

source.enable = function (conf) {
  source.config = conf;
  config.id = conf && conf.id ? conf.id : config.id;
  log("Plugin enabled");
};

// ===========================
// Home
// ===========================

source.getHome = function (continuationToken) {
  log("getHome called continuationToken=" + continuationToken);
  try {
    var homeUrl = BASE_URL_PRIMARY + "/";
    var response = requestGET(homeUrl);
    var doc = parseHTML(response.body, homeUrl);

    var items = requireElements(doc, ".page-item-detail", "getHome");
    log("getHome found items=" + items.length);

    var posts = [];

    items.forEach(function (item, index) {
      try {
        var ctx = "getHome item[" + index + "]";
        var mangaAnchor = requireElement(item, ".post-title a", ctx);
        var chapterAnchor = requireElement(item, ".chapter-item .chapter a", ctx);

        var mangaTitle = requireText(mangaAnchor, ctx + " manga");
        var mangaUrl = toPrimaryUrl(requireAttr(mangaAnchor, "href", ctx + " manga href"));
        var chapterName = requireText(chapterAnchor, ctx + " chapter");
        var chapterUrl = toPrimaryUrl(requireAttr(chapterAnchor, "href", ctx + " chapter href"));

        var postOnEl = requireElement(item, ".post-on", ctx);
        var postedTime = extractTimestamp(requireText(postOnEl, ctx + " post-on"));

        var imgEl = requireElement(item, "img", ctx);
        var thumbUrl = requireImageSrc(imgEl, ctx + " img");

        var mangaIdParts = mangaUrl.split("/manga/");
        var authorId = new PlatformID(PLATFORM, mangaIdParts[1], config.id, PLATFORM_CLAIMTYPE);
        var author = new PlatformAuthorLink(authorId, mangaTitle, mangaUrl, thumbUrl, 0, "");

        var postId = new PlatformID(PLATFORM, chapterUrl, config.id, PLATFORM_CLAIMTYPE);

        // IMPORTANT: url is intentionally empty so Grayjay doesn't route post-click as content URL.
        var postItem = new PlatformPost({
          id: postId,
          author: author,
          name: chapterName,
          datetime: postedTime,
          url: "",
          description: "Open chapter"
        });

        logContentItem("getHome item[" + index + "]", postItem);
        posts.push(postItem);
      } catch (e) {
        log("getHome item[" + index + "] ERROR: " + (e && e.message ? e.message : e));
      }
    });

    log("getHome returning count=" + posts.length);
    return new ContentPager(posts, false, { continuationToken: continuationToken });
  } catch (e) {
    log("getHome FATAL: " + (e && e.message ? e.message : e));
    throw e;
  }
};

// ===========================
// Search
// ===========================

source.searchSuggestions = function (query) { return []; };

source.getSearchCapabilities = function () {
  return {
    types: [Type.Feed.Mixed],
    sorts: [Type.Order.Chronological],
    filters: [],
  };
};

source.search = function (query, type, order, filters, continuationToken) {
  log("search called query=" + query);
  return new ContentPager([], false, { query: query, continuationToken: continuationToken });
};

// ===========================
// Channel search
// ===========================

source.searchChannels = function (query, continuationToken) {
  log("searchChannels query=" + query);
  try {
    var searchUrl = BASE_URL_PRIMARY + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
    var response = requestGET(searchUrl);
    var doc = parseHTML(response.body, searchUrl);

    var anchors = doc.querySelectorAll(".post-title a");
    log("searchChannels found anchors=" + (anchors ? anchors.length : 0));

    var channels = [];
    if (!anchors || anchors.length === 0) {
      return new ChannelPager([], false, { query: query, continuationToken: continuationToken });
    }

    anchors.forEach(function (a, index) {
      try {
        var url = toPrimaryUrl(requireAttr(a, "href", "searchChannels[" + index + "] href"));
        var name = requireText(a, "searchChannels[" + index + "] text");
        var parts = url.split("/manga/");
        var id = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);

        channels.push(new PlatformChannel({
          id: id,
          name: name,
          thumbnail: "",
          banner: "",
          subscribers: 0,
          description: "",
          url: url,
          urlAlternatives: [],
          links: {},
        }));
      } catch (e) {
        log("searchChannels item[" + index + "] ERROR: " + (e && e.message ? e.message : e));
      }
    });

    log("searchChannels returning count=" + channels.length);
    return new ChannelPager(channels, false, { query: query, continuationToken: continuationToken });
  } catch (e) {
    log("searchChannels FATAL: " + (e && e.message ? e.message : e));
    throw e;
  }
};

// ===========================
// Channel
// ===========================

source.isChannelUrl = function (url) {
  url = asUrl(url);
  var ok = REGEX_CHANNEL_URL.test(url);
  log("isChannelUrl url=" + url + " match=" + ok);
  return ok;
};

source.getChannel = function (url) {
  log("getChannel url=" + url);
  try {
    url = toPrimaryUrl(asUrl(url));
    log("getChannel normalized url=" + url);

    var response = requestGET(url);
    var doc = parseHTML(response.body, url);

    var name = requireText(requireElement(doc, "h1", "getChannel"), "getChannel h1");
    var img = doc.querySelector(".tab-summary img") || doc.querySelector(".summary_image img");
    var thumb = img ? requireImageSrc(img, "getChannel img") : "";

    var parts = url.split("/manga/");
    var id = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);

    var channel = new PlatformChannel({
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

    log("getChannel return name=" + name + " id=" + id.value);
    return channel;
  } catch (e) {
    log("getChannel FATAL: " + (e && e.message ? e.message : e));
    throw e;
  }
};

source.getChannelCapabilities = function () {
  return {
    types: [Type.Feed.Mixed],
    sorts: [Type.Order.Chronological],
    filters: [],
  };
};

// ===========================
// Channel contents (chapters as POST workaround)
// ===========================

source.getChannelContents = function (url, type, order, filters, continuationToken) {
  log("getChannelContents url=" + url);
  try {
    url = toPrimaryUrl(asUrl(url));
    log("getChannelContents normalizedUrl=" + url);

    var getResponse = requestGET(url);
    var getDoc = parseHTML(getResponse.body, url);

    var mangaTitle = requireText(requireElement(getDoc, "h1", "getChannelContents"), "getChannelContents h1");
    var summaryImg = getDoc.querySelector(".summary_image img") || getDoc.querySelector(".tab-summary img");
    var mangaThumb = summaryImg ? requireImageSrc(summaryImg, "getChannelContents summary img") : "";

    var parts = url.split("/manga/");
    var authorId = new PlatformID(PLATFORM, parts[1], config.id, PLATFORM_CLAIMTYPE);
    var author = new PlatformAuthorLink(authorId, mangaTitle, url, mangaThumb, 0, "");

    var chapterApiUrl = url + (url.endsWith("/") ? "" : "/") + "ajax/chapters/";
    log("getChannelContents chapterApiUrl=" + chapterApiUrl);

    var postResponse = requestPOST(chapterApiUrl, "");
    var postDoc = parseHTML(postResponse.body, chapterApiUrl);

    var listItems = requireElements(postDoc, "li", "getChannelContents chapters");
    log("getChannelContents chapter count=" + listItems.length);

    var posts = [];

    listItems.forEach(function (li, index) {
      try {
        var a = requireElement(li, "a", "chapter[" + index + "]");
        var chapterName = requireText(a, "chapter[" + index + "] text");
        var chapterLink = toPrimaryUrl(requireAttr(a, "href", "chapter[" + index + "] href"));

        var iEl = li.querySelector("i");
        var postedTime = iEl ? extractTimestamp(requireText(iEl, "chapter[" + index + "] date")) : 0;

        var postId = new PlatformID(PLATFORM, chapterLink, config.id, PLATFORM_CLAIMTYPE);

        var htmlBody =
          '<div style="padding:12px;">' +
          '<p><a href="' + chapterLink + '">Open chapter in browser</a></p>' +
          '<p></p>' +
          '</div>';

        var postItem = new PlatformPostDetails({
          id: postId,
          author: author,
          name: chapterName,
          datetime: postedTime,
          url: chapterLink,
          description: "",
          content: htmlBody,
          textType: Type.Text.HTML
        });

        logContentItem("getChannelContents item[" + index + "]", postItem);
        posts.push(postItem);
      } catch (e) {
        log("getChannelContents item[" + index + "] ERROR: " + (e && e.message ? e.message : e));
      }
    });

    log("getChannelContents returning count=" + posts.length);
    return new ContentPager(posts, false, { continuationToken: continuationToken });
  } catch (e) {
    log("getChannelContents FATAL: " + (e && e.message ? e.message : e));
    throw e;
  }
};
