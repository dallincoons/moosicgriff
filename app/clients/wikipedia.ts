import * as cheerio from "cheerio";

const WIKIPEDIA_USER_AGENT =
    "MoosicGraffBot/2.0 (https://github.com/dallincoons/moosicgraff; contact: dallincoons@gmail.com)";
const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
const wikipediaPageInfoCache = new Map<string, WikipediaPageInfo>();

export type RedirectResolution = {
    isRedirect: boolean;
    originalUrl: string;
    resolvedUrl: string;
    originalTitle: string;
    resolvedTitle: string;
    pageId: number | null;
};

export type WikipediaPageInfo = RedirectResolution & {
    isDisambiguation: boolean;
};

export async function getHtml(url: string): Promise<string> {
    const $ = await loadWikipediaPage(url);
    return $.html();
}

export async function getHtmlAndWikiLinks(url: string): Promise<{ html: string; wikiLinks: string[] }> {
    const $ = await loadWikipediaPage(url);
    const wikiLinks: string[] = [];

    $('a[href^="/wiki/"]').each((_, element) => {
        const href = $(element).attr("href");
        if (!href) {
            return;
        }

        wikiLinks.push(`https://en.wikipedia.org${href}`);
    });

    return {
        html: $.html(),
        wikiLinks,
    };
}
export async function getPageText(url: string): Promise<string> {
    const $ = await loadWikipediaPage(url);
    return $.text();
}

export async function getWikiLinks(url: string): Promise<string[]> {
    const $ = await loadWikipediaPage(url);
    const links: string[] = [];

    $('a[href^="/wiki/"]').each((_, element) => {
        const href = $(element).attr("href");
        if (!href) {
            return;
        }

        links.push(`https://en.wikipedia.org${href}`);
    });

    return links;
}

export async function getListItemWikiLinks(url: string): Promise<string[]> {
    const $ = await loadWikipediaPage(url);
    const links: string[] = [];
    const articleRoot = $("#mw-content-text .mw-parser-output").first();
    const candidates = articleRoot.length
        ? articleRoot.find("ul li a[href^=\"/wiki/\"]")
        : $("ul li a[href^=\"/wiki/\"]");

    candidates.each((_, element) => {
        const href = $(element).attr("href");
        if (!href) {
            return;
        }
        if (href.includes(":") || href.includes("#")) {
            return;
        }

        links.push(`https://en.wikipedia.org${href}`);
    });

    return [...new Set(links)];
}

export async function isMissingArticlePage(url: string): Promise<boolean> {
    const $ = await loadWikipediaPage(url);
    const bodyText = $("body").text();
    const hasNoArticleNode = $("#noarticletext").length > 0;
    const hasNoArticleMessage = /Wikipedia does not have an article with this exact name/i.test(bodyText);
    return hasNoArticleNode || hasNoArticleMessage;
}

export async function getSectionText(url: string, startHeader: string, endHeader: string): Promise<string> {
    const $ = await loadWikipediaPage(url);
    const section = getSectionContent($, startHeader, endHeader);
    return section.text();
}

export async function getSectionWikiLinks(url: string, startHeader: string, endHeader: string): Promise<string[]> {
    const $ = await loadWikipediaPage(url);
    const section = getSectionContent($, startHeader, endHeader);
    const links: string[] = [];

    section.find('a[href^="/wiki/"]').each((_, element) => {
        const href = $(element).attr("href");
        if (!href) {
            return;
        }

        if (href.includes(":") || href.includes("#")) {
            return;
        }

        links.push(`https://en.wikipedia.org${href}`);
    });

    return [...new Set(links)];
}

export async function resolveWikipediaRedirect(url: string): Promise<RedirectResolution> {
    const pageInfo = await resolveWikipediaPageInfo(url);
    return {
        isRedirect: pageInfo.isRedirect,
        originalUrl: pageInfo.originalUrl,
        resolvedUrl: pageInfo.resolvedUrl,
        originalTitle: pageInfo.originalTitle,
        resolvedTitle: pageInfo.resolvedTitle,
        pageId: pageInfo.pageId,
    };
}

export async function resolveWikipediaPageInfo(url: string): Promise<WikipediaPageInfo> {
    const normalizedUrl = normalizeWikipediaUrl(url);
    const cached = wikipediaPageInfoCache.get(normalizedUrl);
    if (cached) {
        return cached;
    }

    const title = getPageTitleFromWikiUrl(normalizedUrl);
    if (!title) {
        const fallback = {
            isRedirect: false,
            originalUrl: normalizedUrl,
            resolvedUrl: normalizedUrl,
            originalTitle: "",
            resolvedTitle: "",
            pageId: null,
            isDisambiguation: false,
        };
        wikipediaPageInfoCache.set(normalizedUrl, fallback);
        return fallback;
    }

    try {
        const body = await fetchWikiApiJson<{
            query?: {
                pages?: Array<{ title?: string; pageid?: number; pageprops?: { disambiguation?: string } }>;
                redirects?: Array<{ from?: string; to?: string }>;
            };
        }>(getWikiPageInfoApiUrl(title), title, "pageinfo");

        const page = body.query?.pages?.[0];
        const resolvedTitle = page?.title || title;
        const resolvedUrl = buildWikiUrlFromTitle(resolvedTitle);
        const pageId = typeof page?.pageid === "number" ? page.pageid : null;
        const isRedirect = (body.query?.redirects?.length || 0) > 0;
        const isDisambiguation = !!page?.pageprops && Object.prototype.hasOwnProperty.call(page.pageprops, "disambiguation");

        const result = {
            isRedirect,
            originalUrl: normalizedUrl,
            resolvedUrl,
            originalTitle: title,
            resolvedTitle,
            pageId,
            isDisambiguation,
        };

        wikipediaPageInfoCache.set(normalizedUrl, result);
        return result;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[wiki-api] page info lookup failed for "${title}": ${message}`);
        const fallback = {
            isRedirect: false,
            originalUrl: normalizedUrl,
            resolvedUrl: normalizedUrl,
            originalTitle: title,
            resolvedTitle: title,
            pageId: null,
            isDisambiguation: false,
        };
        wikipediaPageInfoCache.set(normalizedUrl, fallback);
        return fallback;
    }
}

export async function isWikipediaDisambiguationPage(url: string): Promise<boolean> {
    const pageInfo = await resolveWikipediaPageInfo(url);
    return pageInfo.isDisambiguation;
}

async function loadWikipediaPage(url: string) {
    return cheerio.fromURL(url, {
        requestOptions: {
            headers: {
                "User-Agent": WIKIPEDIA_USER_AGENT,
            },
            method: "GET",
        },
    });
}

function getSectionContent($: cheerio.CheerioAPI, startHeader: string, endHeader: string): cheerio.Cheerio<any> {
    const contentRoot = getArticleContentRoot($);
    let start = findHeading($, startHeader, contentRoot);
    if (start.length && !start.is("h1,h2,h3,h4,h5,h6")) {
        start = start.closest("h1,h2,h3,h4,h5,h6");
    }
    if (!start.length) {
        return $();
    }

    const startContainer = getHeadingContainer(start);
    const startLevel = headingLevel(start);
    const endNormalized = normalizeHeader(endHeader);
    const nodes: any[] = [];
    let cursor = startContainer.next();

    while (cursor.length) {
        const headingInCursor = getHeadingFromNode($, cursor);
        if (headingInCursor.length) {
            if (endNormalized && isHeadingMatch($, headingInCursor, endNormalized)) {
                break;
            }

            const cursorLevel = headingLevel(headingInCursor);
            if (cursorLevel > 0 && cursorLevel <= startLevel) {
                break;
            }
        }

        nodes.push(cursor.get(0));
        cursor = cursor.next();
    }

    return $(nodes);
}

function findHeading($: cheerio.CheerioAPI, header: string, root?: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
    const normalizedTarget = normalizeHeader(header);
    const scope = root && root.length ? root : $.root();

    const byId = scope.find("[id]").filter((_, element) => {
        const id = $(element).attr("id") || "";
        return normalizeHeader(id) === normalizedTarget;
    }).first();

    if (byId.length) {
        if (byId.is("h1,h2,h3,h4,h5,h6")) {
            return byId;
        }
        const idHeading = byId.parents("h1,h2,h3,h4,h5,h6").first();
        if (idHeading.length) {
            return idHeading;
        }
    }

    const headline = scope.find("span.mw-headline").filter((_, element) => {
        const id = $(element).attr("id") || "";
        const text = $(element).text() || "";
        return normalizeHeader(id) === normalizedTarget || normalizeHeader(text) === normalizedTarget;
    }).first();

    if (headline.length) {
        const heading = headline.parents("h2,h3,h4,h5,h6").first();
        if (heading.length) {
            return heading;
        }
    }

    const headings = scope.find("h2,h3,h4,h5,h6");
    for (let i = 0; i < headings.length; i++) {
        const heading = headings.eq(i);
        if (isHeadingMatch($, heading, normalizedTarget)) {
            return heading;
        }
    }

    return $();
}

function getArticleContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
    const parserOutput = $("#mw-content-text .mw-parser-output").first();
    if (parserOutput.length) {
        return parserOutput;
    }

    const contentText = $("#mw-content-text").first();
    if (contentText.length) {
        return contentText;
    }

    return $.root();
}

function isHeadingMatch($: cheerio.CheerioAPI, heading: cheerio.Cheerio<any>, normalizedTarget: string): boolean {
    const headingId = heading.attr("id") || "";
    const headline = heading.find(".mw-headline").first();
    const headlineId = headline.attr("id") || "";
    const headlineText = headline.text() || "";
    const headingText = heading.text() || "";

    return normalizeHeader(headingId) === normalizedTarget
        || normalizeHeader(headlineId) === normalizedTarget
        || normalizeHeader(headlineText) === normalizedTarget
        || normalizeHeader(headingText) === normalizedTarget;
}

function headingLevel(heading: cheerio.Cheerio<any>): number {
    const tag = (heading.get(0)?.tagName || "").toLowerCase();
    if (!/^h[1-6]$/.test(tag)) {
        return 0;
    }
    return parseInt(tag.slice(1), 10);
}

function getHeadingContainer(heading: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
    const parent = heading.parent();
    if (parent.is(".mw-heading")) {
        return parent;
    }
    return heading;
}

function getHeadingFromNode($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
    if (node.is("h1,h2,h3,h4,h5,h6")) {
        return node;
    }
    const nestedHeading = node.find("h1,h2,h3,h4,h5,h6").first();
    if (nestedHeading.length) {
        return nestedHeading;
    }
    return $();
}

function normalizeHeader(value: string): string {
    return (value || "")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\[edit]/g, "")
        .trim();
}

function getWikiPageInfoApiUrl(title: string): string {
    return `${WIKIPEDIA_API_URL}?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&titles=${encodeURIComponent(title)}`;
}

function getPageTitleFromWikiUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const pageTitle = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, "")).trim();
        return pageTitle;
    } catch (e) {
        return "";
    }
}

function buildWikiUrlFromTitle(title: string): string {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

function normalizeWikipediaUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `https://en.wikipedia.org${parsed.pathname}`;
    } catch (e) {
        return url;
    }
}

async function fetchWikiApiJson<T>(url: string, title: string, purpose: string): Promise<T> {
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await fetch(url, {
            headers: {
                "User-Agent": WIKIPEDIA_USER_AGENT,
            },
        });

        if (response.status === 429 && attempt < maxAttempts) {
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
            const backoffMs = Number.isNaN(retryAfterSeconds)
                ? Math.min(1000 * Math.pow(2, attempt - 1), 15000)
                : retryAfterSeconds * 1000;
            const jitterMs = Math.floor(Math.random() * 500);
            const sleepMs = backoffMs + jitterMs;
            console.warn(`[wiki-api] 429 for "${title}" (${purpose}) attempt ${attempt}/${maxAttempts}; retrying in ${sleepMs}ms`);
            await sleep(sleepMs);
            continue;
        }

        if (!response.ok) {
            const bodyPreview = (await response.text()).slice(0, 220).replace(/\s+/g, " ");
            throw new Error(`status ${response.status}, body preview: ${bodyPreview}`);
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const rawBody = await response.text();
        if (!contentType.includes("application/json")) {
            throw new Error(`non-json content-type "${contentType}", body preview: ${rawBody.slice(0, 220).replace(/\s+/g, " ")}`);
        }

        try {
            return JSON.parse(rawBody) as T;
        } catch (e) {
            throw new Error(`invalid json response, body preview: ${rawBody.slice(0, 220).replace(/\s+/g, " ")}`);
        }
    }

    throw new Error(`max attempts reached for "${title}" (${purpose})`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
