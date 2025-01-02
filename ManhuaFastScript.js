const PLATFORM = "ManhuaFast";
const PLATFORM_CLAIMTYPE = 2;
const REGEX_HUMAN_AGO = new RegExp("([0-9]+) (second|seconds|min|mins|hour|hours|day|days|week|weeks|month|months|year|years) ago");
const REGEX_CHANNEL_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+)\/$");
const REGEX_CONTENT_URL = new RegExp("^https:\/\/manhuafast\.com\/manga\/([^\/]+(?:\/[^\/]+)+)\/$");

const config = {};

source.enable = function (conf) {
    /**
     * Initialize the plugin configuration.
     * @param conf: SourceV8PluginConfig (the SomeConfig.js)
     */
    this.config = conf;
    console.log("WP Manga plugin enabled with config: ", conf);
}

function extract_Timestamp(str) {
    if (!str) return 0;

    // Check if the string matches the "X hours ago" pattern
    const match = str.match(REGEX_HUMAN_AGO);
    if (match) {
        const value = parseInt(match[1]);
        const now = parseInt(new Date().getTime() / 1000);

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
                return now - value * 60 * 60 * 24 * 30; // Approximation
            case "year":
            case "years":
                return now - value * 60 * 60 * 24 * 365; // Approximation
            default:
                throw new Error("Unknown time type: " + match[2]);
        }
    }

    // If the string doesn't match "X hours ago", check if it's a date string
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
        // Convert to Unix timestamp (in seconds)
        return Math.floor(date.getTime() / 1000);
    }

    // If it's neither a valid "X hours ago" format nor a valid date, return 0
    return 0;
}

source.getHome = function(continuationToken) {
    /**
     * Fetch the home page data, typically showcasing featured or recent manga.
     * @param continuationToken: any? (to handle pagination)
     * @returns: VideoPager
     */
    const homeUrl = "https://manhuafast.com/"; // Home URL where manga is listed
    const response = http.GET(homeUrl,{}, false);
    const html = response.body;  // Use directly as text
    const doc = domParser.parseFromString(html, "text/html");

    const mangaItems = [];
    doc.querySelectorAll(".page-item-detail").forEach((item) => {
        const mangaAnchor = item.querySelector(".post-title a") // This targets the <a> inside .item-thumb div
        const mangaChapterAnchor = item.querySelector(".chapter-item .chapter a")

        const mangaTitle = mangaAnchor.textContent   .trim() // The author is now the name in the title
        const mangaLink = mangaAnchor.getAttribute('href')
        const mangaId = mangaLink.split('/manga/')[1] // ID is the part after "/manga/"

        const mangaChapter = mangaChapterAnchor.textContent.trim()
        const mangaChapterLink = mangaChapterAnchor.getAttribute('href')

        // Extract the timestamp (text content from the 'post-on' span)
        const mangaPostedTime = extract_Timestamp(item.querySelector(".post-on").textContent.trim())
        // Get the actual image source from 'data-src'

        const mangaThumbnail = item.querySelector("img").getAttribute("data-src") 
        // There's no description in this part of the structure, so leave it empty
        const mangaDescription = "" 

        const id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE)
        const author = new PlatformAuthorLink(id, mangaTitle, mangaLink, mangaThumbnail, 0, "")
        const thumbnail = new Thumbnail(mangaThumbnail, 1)
        const thumbnails = new Thumbnails([thumbnail])
        
        const manga = {
            // Extracting everything after '/manga/' in the href URL for the ID
            id: id,
            author: author, // The author is now the name in the title
            // Extract the chapter from the chapter link text
            name: mangaChapter,
            // Extract the timestamp (text content from the 'post-on' span)
            datetime: mangaPostedTime,
            thumbnails: [], // Get the actual image source from 'data-src'
            description: "", // There's no description in this part of the structure, so leave it empty
            url: mangaChapterLink,
            images: [],
            contentUrl: mangaChapterLink,
            contentName: mangaChapter,
            contentDescription: "",
            contentProvider: author
    };
        mangaItems.push(new PlatformNestedMediaContent(manga));
    });

    const hasMore = false; // Pagination is assumed to be non-existent here
    const context = { continuationToken }; // Provide continuation token data for paginated requests
    return new ContentPager(mangaItems, hasMore, context);
}

source.searchSuggestions = function(query) {
    return [];
}

source.getSearchCapabilities = function() {
    /**
     * Returns search capabilities such as available sorts, filters, etc.
     * @returns: Object
     */
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological, "^release_time"],
        filters: [] // No filters defined here
    };
}

source.search = function(query, type, order, filters, continuationToken) {
    /**
     * Fetches search results based on the query, filters, and order.
     * @param query: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */
    const searchUrl = `https://example.com/?s=${encodeURIComponent(query)}`;
    const response = fetch(searchUrl); // Send request
    const html = response.text(); // Get HTML response

    const doc = new DOMParser().parseFromString(html, "text/html");
    const results = [];
    
    doc.querySelectorAll(".manga-item").forEach((item) => {
        const manga = {
            id: item.querySelector("a").href,
            name: item.querySelector(".manga-title").textContent.trim(),
            thumbnail: item.querySelector("img").src,
            description: item.querySelector(".manga-description").textContent.trim(),
        };
        results.push(manga);
    });

    const hasMore = false; // No pagination, adjust if applicable
    const context = { query, continuationToken };
    return new SomeSearchVideoPager(results, hasMore, context);
}

source.searchChannels = function(query, continuationToken) {
    /**
     * Search for manga channels based on query.
     * @param query: string
     * @param continuationToken: any?
     * @returns: ChannelPager
     */
    const searchUrl = "https://manhuafast.com/?s="+query+"&post_type=wp-manga"
    const response = http.GET(searchUrl,{},false)
    const html = response.body;  // Use directly as text
    const doc = domParser.parseFromString(html, "text/html");

    const channels = [];
//new PlatformAuthorLink( mangaId, mangaName, item.getAttribute('href').trim(), "", 0, "") 
    doc.querySelectorAll(".post-title a").forEach((item) => {
        const mangaId = new PlatformID(PLATFORM, item.getAttribute('href').split('/manga/')[1], config.id, PLATFORM_CLAIMTYPE);
        const mangaName = item.textContent.trim();
        const mangaLink = item.getAttribute('href');
        const mangaThumbnail = "";

        const channel = {
            id: mangaId,
            name: mangaName,
            thumbnail: mangaThumbnail,
            banner: "",
            subscibers: 0,
            description: "",
            url: mangaLink,
            urlAlternatives: [],
            links: {}
        };
        channels.push(new PlatformChannel(channel));
    });

    const hasMore = false;
    const context = { query, continuationToken };
    return new ChannelPager(channels, hasMore, context);
}

source.isChannelUrl = function(url) {
    /**
     * Checks if the URL is a valid manga channel URL.
     * @param url: string
     * @returns: boolean
     */
    return REGEX_CHANNEL_URL.test(url); // Simple regex to match the WP Manga URL structure
}

source.getChannel = function(url) {
    /**
     * Fetches channel details (manga series).
     * @param url: string
     * @returns: PlatformChannel
     */
    const response = http.GET(url,{}, false);
    const html = response.body;  // Use directly as text
    const doc = domParser.parseFromString(html, "text/html");

    const name = doc.querySelector("h1").textContent.trim();
    const channelThumbnail = doc.querySelector(".tab-summary img").getAttribute("data-src") 

    const mangaId = url.split('/manga/')[1] // ID is the part after "/manga/"
    const id = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE)

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

source.isVideoDetailsUrl = function (url)  {
    return false;
}

source.getChannelContents = function(url, type, order, filters, continuationToken) {
    /**
     * Fetches manga chapters for a specific manga URL (channel).
     * @param url: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */
    const getResponse = http.GET(url+"ajax/chapters/",{}, false);
    let html = getResponse.body;  // Use directly as text
    let doc = domParser.parseFromString(html, "text/html");

    const mangaId = url.split('/manga/')[1] // ID is the part after "/manga/"
    const mangaTitle = doc.querySelector("h1").textContent.trim();
    const mangaThumbnail = doc.querySelector(".summary_image img").getAttribute("data-src")
    const AuthorId = new PlatformID(PLATFORM, mangaId, config.id, PLATFORM_CLAIMTYPE)
    const author = new PlatformAuthorLink(AuthorId, mangaTitle, url, mangaThumbnail, 0, "")
    const thumbnail = new Thumbnail(mangaThumbnail, 1)
    const thumbnails = [new Thumbnails([thumbnail])]
    const mangaDescription = ""

    const postResponse = http.POST(url+"ajax/chapters","",{}, false);
    html = postResponse.body;  // Use directly as text
    doc = domParser.parseFromString(html, "text/html");

    const chapters = []
    doc.querySelectorAll("li").forEach((item) => {
        const mangaChapter = item.querySelector("a").textContent.trim();
        const mangaChapterLink = item.querySelector("a").getAttribute('href');
        const mangaPostedTime = extract_Timestamp(item.querySelector("i").textContent.trim());
        const chapterId = new PlatformID(PLATFORM, mangaChapter, config.id, PLATFORM_CLAIMTYPE)

        const chapter = {
            id: chapterId,
            author: author, // The author is now the name in the title
            // Extract the chapter from the chapter link text
            name: mangaChapter,
            // Extract the timestamp (text content from the 'post-on' span)
            datetime: mangaPostedTime,
            description: mangaDescription,
            thumbnails: [], // Get the actual image source from 'data-src'
            description: "", // There's no description in this part of the structure, so leave it empty
            url: mangaChapterLink,
            images: [],
            contentUrl: mangaChapterLink,
            contentName: mangaChapter,
            contentDescription: ""
        };
        chapters.push(new PlatformNestedMediaContent(chapter));
    })

    const hasMore = false; // Pagination is assumed to be non-existent here
    const context = { continuationToken }; // Provide continuation token data for paginated requests
    return new ContentPager(chapters, hasMore, context);
}

source.isContentDetailsUrl = function(url) {
    /**
     * Checks if the URL corresponds to content details (chapter details).
     * @param url: string
     * @returns: boolean
     */
    //return REGEX_CONTENT_URL.test(url); // Matches chapter URLs
    return false;
}

source.getContentDetails = function(url) {
    /**
     * Fetches detailed information for a manga chapter.
     * @param url: string
     * @returns: PlatformVideoDetails
     */

    const response = http.GET(url,{}, false);
    let html = response.body;  // Use directly as text
    html = html.replace(/\s+/g, ' ').trim();
    
    const doc = domParser.parseFromString(html, "text/html");
    // Extract images from the document
    const mangaId = url.split('/manga/')[1] // ID is the part after "/manga/"

    const images = [];

    // Create a new Thumbnails object to hold all thumbnail instances
    const thumbnailsArray = [];
    
    // Select all <img> elements
    doc.querySelectorAll("img").forEach((item) => {
        // Fetch the data-src attribute for each image
        const dataSrc = item.getAttribute("data-src").trim();
        
        // If data-src exists, add it to the images array
        if (dataSrc) {
            images.push(dataSrc);
            thumbnailsArray.push(new Thumbnails([new Thumbnail(dataSrc, 1080)]));
        }
    });

    const id = new PlatformID(PLATFORM, "test", config.id, PLATFORM_CLAIMTYPE)
        // Create an object
        const details = new PlatformNestedMediaContentDetails({
            id: id,
            name: mangaId,
            author: new PlatformAuthorLink(id,"test","test","",0,""),
            datetime: 0,
            url: "https://www.google.com",
            description: "TEST2",
            images: images,
            thumbnails: thumbnailsArray,
            rating: new RatingLikes(0),
            textType: Type.Text.RAW,
            content: ""
        });
    
        return details;
    }
    

source.getComments = function(url, continuationToken) {
    /**
     * Fetches comments for a manga chapter.
     * @param url: string
     * @param continuationToken: any?
     * @returns: CommentPager
     */
    const response = fetch(url); // Get chapter page HTML
    const html = response.text();

    const doc = new DOMParser().parseFromString(html, "text/html");

    const comments = [];
    doc.querySelectorAll(".comment-item").forEach((item) => {
        const comment = {
            user: item.querySelector(".comment-user").textContent.trim(),
            content: item.querySelector(".comment-content").textContent.trim(),
            date: item.querySelector(".comment-date").textContent.trim(),
        };
        comments.push(comment);
    });

    const hasMore = false; // Assuming no pagination here
    const context = { url, continuationToken };
    return new SomeCommentPager(comments, hasMore, context);
}
