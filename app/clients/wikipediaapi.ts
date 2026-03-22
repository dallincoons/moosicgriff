import {Release} from "app/discography/release";

type WikiQueryResponse = {
    query?: {
        pages?: Array<{
            missing?: boolean;
            pageid?: number;
            title?: string;
            categories?: Array<{ title?: string }>;
            revisions?: Array<{ content?: string; slots?: { main?: { content?: string } } }>;
        }>
    }
};

export async function getAlbumReleaseFromApi(pageUrl: string): Promise<Release | null> {
    return getAlbumReleaseFromApiByTitle(getPageTitleFromUrl(pageUrl), 0);
}

async function getAlbumReleaseFromApiByTitle(pageTitle: string, depth: number): Promise<Release | null> {
    if (depth > 5) {
        return null;
    }

    const apiUrl = getWikiApiUrl(pageTitle);
    const response = await fetchWithRetry(apiUrl, pageTitle);
    const contentType = response.headers.get("content-type") || "";

    console.log(`[wiki-api] title="${pageTitle}" depth=${depth} status=${response.status} content-type="${contentType}" url="${response.url}"`);

    const rawBody = await response.text();
    if (!contentType.toLowerCase().includes("application/json")) {
        console.error(`[wiki-api] non-json response for "${pageTitle}" (${response.status})`);
        console.error(`[wiki-api] body preview: ${rawBody.slice(0, 300).replace(/\s+/g, " ")}`);
        throw new Error(`Expected JSON but got content-type "${contentType}"`);
    }

    let data: WikiQueryResponse;
    try {
        data = JSON.parse(rawBody) as WikiQueryResponse;
    } catch (e) {
        console.error(`[wiki-api] JSON parse failure for "${pageTitle}" (${response.status})`);
        console.error(`[wiki-api] body preview: ${rawBody.slice(0, 300).replace(/\s+/g, " ")}`);
        throw e;
    }
    const page = data.query?.pages?.[0];

    if (!page || page.missing) {
        return null;
    }
    if ((page.title || pageTitle).startsWith("List of ")) {
        return null;
    }

    const wikitext = page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.content || "";
    if (!wikitext) {
        return null;
    }

    const redirectTarget = getRedirectTarget(wikitext);
    if (redirectTarget) {
        return getAlbumReleaseFromApiByTitle(redirectTarget, depth + 1);
    }

    if (!isAlbumPage(wikitext, page.categories ?? [])) {
        return null;
    }

    const releasedRaw = getInfoboxValue(wikitext, "released");
    const rawArtist = getInfoboxValue(wikitext, "artist");
    const rawGenre = getInfoboxValue(wikitext, "genre");
    const artistNames = parseArtistNames(rawArtist);
    const {year, month, day} = parseReleaseDate(releasedRaw);
    const reviewLinks = collectUniqueReviewLinks(wikitext);
    const reviewLinksCsv = reviewLinks.join(", ");
    const numberOfReviews = reviewLinks.length;
    const infoboxTitle = normalizeValue(getInfoboxValue(wikitext, "name"));
    const pageResolvedTitle = normalizeWikiTitle(page.title || pageTitle);
    const originalTitle = pageResolvedTitle || infoboxTitle;
    const normalizedTitle = stripReleaseDisambiguator(infoboxTitle || pageResolvedTitle);

    return {
        artist_wikilink: artistNames.artistWikilink,
        artist_name: artistNames.articleName,
        artist_display_name: artistNames.displayName,
        name: normalizedTitle,
        original_title: originalTitle,
        producer: normalizeListValue(getInfoboxValue(wikitext, "producer")),
        studio: normalizeListValue(getInfoboxValue(wikitext, "studio")),
        type: normalizeValue(getInfoboxValue(wikitext, "type")),
        label: normalizeLabelValue(getInfoboxValue(wikitext, "label")),
        genre: normalizeGenreValue(rawGenre),
        original_genre: rawGenre,
        recorded: normalizeListValue(getInfoboxValue(wikitext, "recorded")),
        year,
        month,
        day,
        wikilink: buildWikiUrlFromTitle(page.title || pageTitle),
        wikipedia_page_id: page.pageid ?? null,
        number_of_reviews: numberOfReviews,
        review_links: reviewLinksCsv,
    };
}

function getWikiApiUrl(pageTitle: string): string {
    return `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions|categories&rvslots=main&rvprop=content&cllimit=max&titles=${encodeURIComponent(pageTitle)}`;
}

function getPageTitleFromUrl(url: string): string {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.replace(/^\/wiki\//, ""));
}

function buildWikiUrlFromTitle(title: string): string {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

function getRedirectTarget(wikitext: string): string {
    const match = wikitext.match(/^#redirect\s*\[\[([^\]]+)]]/im);
    if (!match || !match[1]) {
        return "";
    }

    return match[1].split("|")[0].trim();
}

async function fetchWithRetry(url: string, pageTitle: string): Promise<Response> {
    const maxAttempts = 5;
    let attempt = 0;

    while (true) {
        attempt += 1;
        const response = await fetch(url, {
            headers: {
                "User-Agent": "MoosicGraffBot/2.0 (https://github.com/dallincoons/moosicgraff; contact: dallincoons@gmail.com)",
            },
        });

        if (response.status !== 429 || attempt >= maxAttempts) {
            return response;
        }

        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
        const backoffMs = Number.isNaN(retryAfterSeconds)
            ? Math.min(1000 * Math.pow(2, attempt - 1), 15000)
            : retryAfterSeconds * 1000;
        const jitterMs = Math.floor(Math.random() * 500);
        const sleepMs = backoffMs + jitterMs;

        console.warn(`[wiki-api] 429 for "${pageTitle}" attempt ${attempt}/${maxAttempts}; retrying in ${sleepMs}ms`);
        await sleep(sleepMs);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArtistNames(rawArtistField: string): { articleName: string; displayName: string; artistWikilink: string } {
    const raw = rawArtistField || "";
    const linkMatch = raw.match(/\[\[([^[\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/);

    if (linkMatch && linkMatch[1]) {
        const articleName = stripBandSuffix(normalizeWikiTitle(linkMatch[1]));
        const displayName = stripBandSuffix(normalizeValue(linkMatch[2] || linkMatch[1]));
        return {
            articleName,
            displayName: displayName || articleName,
            artistWikilink: buildWikiUrlFromTitle(linkMatch[1].split("#")[0].trim()),
        };
    }

    const normalized = stripBandSuffix(normalizeValue(raw));
    return {
        articleName: normalized,
        displayName: normalized,
        artistWikilink: "",
    };
}

function normalizeWikiTitle(title: string): string {
    return decodeURIComponent(title.replace(/_/g, " ")).trim();
}

function stripBandSuffix(value: string): string {
    return (value || "").replace(/\s*\(band\)\s*$/i, "").trim();
}

function isAlbumPage(wikitext: string, categories: Array<{ title?: string }>): boolean {
    const hasAlbumInfobox = /\{\{\s*infobox\s+album/i.test(wikitext);
    const hasAlbumCategory = categories.some((category) => {
        const title = (category.title || "").toLowerCase();
        return title.includes("albums") && !title.includes("lists");
    });

    return hasAlbumInfobox || hasAlbumCategory;
}

function getInfoboxValue(wikitext: string, field: string): string {
    const infobox = extractInfobox(wikitext);
    if (!infobox) {
        return "";
    }

    const lines = infobox.split("\n");
    const fieldRegex = new RegExp(`^\\|[ \\t]*${field}[ \\t]*=[ \\t]*(.*)$`, "i");
    const startIndex = lines.findIndex((line) => fieldRegex.test(line));
    if (startIndex < 0) {
        return "";
    }

    const startMatch = lines[startIndex].match(fieldRegex);
    const collected: string[] = [];
    if (startMatch?.[1]) {
        collected.push(startMatch[1]);
    }

    for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\|/.test(line)) {
            break;
        }
        if (line.trim() === "}}") {
            break;
        }
        collected.push(line);
    }

    return collected.join("\n").trim();
}

function extractInfobox(wikitext: string): string {
    const start = wikitext.search(/\{\{\s*infobox\s+album/i);
    if (start < 0) {
        return "";
    }

    let depth = 0;
    for (let i = start; i < wikitext.length - 1; i++) {
        const pair = wikitext.slice(i, i + 2);
        if (pair === "{{") {
            depth += 1;
            i += 1;
            continue;
        }
        if (pair === "}}") {
            depth -= 1;
            i += 1;
            if (depth === 0) {
                return wikitext.slice(start, i + 1);
            }
        }
    }

    return wikitext.slice(start);
}

function parseReleaseDate(raw: string): { year: number | null; month: string; day: number | null } {
    if (!raw) {
        return { year: null, month: "", day: null };
    }

    const firstCandidate = selectFirstReleaseDateCandidate(raw);
    const startDateMatch = firstCandidate.match(/\{\{\s*start date[^|}]*\|(\d{4})(?:\|(\d{1,2}))?(?:\|(\d{1,2}))?/i);
    if (startDateMatch) {
        const year = parseInt(startDateMatch[1], 10);
        const monthNumber = startDateMatch[2] ? parseInt(startDateMatch[2], 10) : null;
        const day = startDateMatch[3] ? parseInt(startDateMatch[3], 10) : null;

        return {
            year: Number.isNaN(year) ? null : year,
            month: monthNumber ? monthName(monthNumber) : "",
            day: day && !Number.isNaN(day) ? day : null,
        };
    }

    const normalized = normalizeValue(firstCandidate);
    const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
    const monthMatch = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
    const dayMatch = normalized.match(/\b([1-2]?\d|3[0-1])\b/);

    return {
        year: yearMatch ? parseInt(yearMatch[0], 10) : null,
        month: monthMatch ? capitalize(monthMatch[0]) : "",
        day: dayMatch ? parseInt(dayMatch[1], 10) : null,
    };
}

function selectFirstReleaseDateCandidate(raw: string): string {
    const normalizedBreaks = raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\r/g, "")
        .replace(/\{\{\s*(?:plainlist|flatlist|hlist)\s*\|/gi, "")
        .replace(/^\s*[\*\-]\s*/gm, "")
        .trim();

    if (!normalizedBreaks) {
        return raw;
    }

    const lines = normalizedBreaks
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length === 0) {
        return normalizedBreaks;
    }

    const firstDateLikeLine = lines.find((line) => /start date|\b(19|20)\d{2}\b|January|February|March|April|May|June|July|August|September|October|November|December/i.test(line));
    return firstDateLikeLine || lines[0];
}

export const __private = {
    parseReleaseDate,
    selectFirstReleaseDateCandidate,
};

function normalizeValue(value: string): string {
    return value
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\{\{[^{}]*}}/g, " ")
        .replace(/\{\{[^{}]*$/g, " ")
        // Handle tuple-style links like [[Electronic music, Electronic]] -> Electronic music
        .replace(/\[\[([^|\]]+?),\s*[^\]]+]]/g, "$1")
        .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)]]/g, "$1")
        .replace(/\[[^\]]*]/g, "")
        .replace(/''+/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s*\/\s*/g, ", ")
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/(?:,\s*){2,}/g, ", ")
        .replace(/^,\s*|\s*,$/g, "")
        .trim();
}

function stripReleaseDisambiguator(value: string): string {
    return (value || "")
        .replace(/\s+\((?:[^()]*\s)?album\)$/i, "")
        .replace(/\s+\((?:[^()]*\s)?ep\)$/i, "")
        .trim();
}

function normalizeListValue(value: string): string {
    const listLike = value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\{\{\s*flatlist\s*\|/gi, "")
        .replace(/\{\{\s*plainlist\s*\|/gi, "")
        .replace(/\{\{\s*hlist\s*\|/gi, "")
        .replace(/\{\{\s*ubl\s*\|/gi, "")
        .replace(/\{\{\s*unbulleted list\s*\|/gi, "")
        .replace(/\}\}/g, "")
        .replace(/\{\{[^{}]*}}/g, " ")
        .replace(/\|/g, "\n")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const items = listLike
        .map((line) => line.replace(/^\*+\s*/, ""))
        .flatMap((line) => normalizeTupleSeconds(line))
        .map((line) => normalizeValue(line))
        .filter((line) => line.length > 0);

    const joined = [...new Set(items)].join(", ");
    return normalizeValue(joined);
}

function normalizeGenreValue(value: string): string {
    const normalized = normalizeListValue(value)
        .replace(/\s*\/\s*/g, ", ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/(?:,\s*){2,}/g, ", ")
        .replace(/^,\s*|\s*,$/g, "");

    return normalizeValue(normalized);
}

function normalizeLabelValue(value: string): string {
    const normalized = normalizeListValue(value);
    const parts = normalized
        .split(/\s*,\s*|\s+\*\s+|(?<=\))\s+(?=[^(]+?\()/)
        .map((part) => part.replace(/\s*\([^)]*\)/g, "").trim())
        .filter((part) => part.length > 0);

    return normalizeValue([...new Set(parts)].join(", "));
}

function normalizeTupleSeconds(line: string): string[] {
    const tupleRegex = /\[\[([^|\]]+?),\s*([^\]]+?)]]/g;
    const tupleNormalized = line.replace(tupleRegex, "$1");

    return tupleNormalized
        .split(/\s*,\s*|\s+\*\s+/)
        .map((part) => part.replace(/\[\[([^|\]]+?)(?:\|[^\]]+)?]]/g, "$1"))
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

function monthName(month: number): string {
    const months = [
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];

    return months[month] || "";
}

function capitalize(value: string): string {
    if (!value) {
        return value;
    }
    return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

function collectUniqueReviewLinks(wikitext: string): string[] {
    const links = new Set<string>();
    const ratingsBlocks = extractNamedTemplates(wikitext, new Set(["album ratings", "music ratings"]));

    for (const block of ratingsBlocks) {
        addLinksToSet(block, links);
    }

    const criticalReceptionSection = extractSection(wikitext, "critical reception");
    if (criticalReceptionSection) {
        addLinksToSet(criticalReceptionSection, links);
    }

    return [...links];
}

function extractNamedTemplates(wikitext: string, targetNames: Set<string>): string[] {
    const templates: string[] = [];

    for (let i = 0; i < wikitext.length - 1; i++) {
        if (wikitext.slice(i, i + 2) !== "{{") {
            continue;
        }

        let cursor = i + 2;
        while (cursor < wikitext.length && /\s/.test(wikitext[cursor])) {
            cursor += 1;
        }

        const nameStart = cursor;
        while (cursor < wikitext.length && !["|", "}", "\n"].includes(wikitext[cursor])) {
            cursor += 1;
        }

        const rawName = wikitext.slice(nameStart, cursor).trim().replace(/_/g, " ").toLowerCase();
        if (!targetNames.has(rawName)) {
            continue;
        }

        let depth = 1;
        let end = cursor;
        while (end < wikitext.length - 1 && depth > 0) {
            const pair = wikitext.slice(end, end + 2);
            if (pair === "{{") {
                depth += 1;
                end += 2;
                continue;
            }
            if (pair === "}}") {
                depth -= 1;
                end += 2;
                continue;
            }
            end += 1;
        }

        templates.push(wikitext.slice(i, end));
        i = end - 1;
    }

    return templates;
}

function extractSection(wikitext: string, sectionName: string): string {
    const lines = wikitext.split("\n");
    let capture = false;
    let headingLevel = 0;
    const captured: string[] = [];

    for (const line of lines) {
        const heading = line.match(/^(=+)\s*(.*?)\s*\1\s*$/);
        if (heading) {
            const level = heading[1].length;
            const title = heading[2].trim().toLowerCase();

            if (!capture && title === sectionName.toLowerCase()) {
                capture = true;
                headingLevel = level;
                continue;
            }

            if (capture && level <= headingLevel) {
                break;
            }
        }

        if (capture) {
            captured.push(line);
        }
    }

    return captured.join("\n");
}

function addLinksToSet(content: string, target: Set<string>): void {
    const externalBracketLinkRegex = /\[(https?:\/\/[^\s\]]+)/gi;
    let externalMatch: RegExpExecArray | null;
    while ((externalMatch = externalBracketLinkRegex.exec(content)) !== null) {
        if (isAllowedReviewUrl(externalMatch[1])) {
            target.add(externalMatch[1]);
        }
    }

    const citeUrlRegex = /\|\s*url\s*=\s*(https?:\/\/[^\s|}]+)/gi;
    let citeMatch: RegExpExecArray | null;
    while ((citeMatch = citeUrlRegex.exec(content)) !== null) {
        if (isAllowedReviewUrl(citeMatch[1])) {
            target.add(citeMatch[1]);
        }
    }
}

function isAllowedReviewUrl(url: string): boolean {
    if (isWikipediaUrl(url)) {
        return false;
    }
    if (isMetacriticUrl(url)) {
        return false;
    }
    return true;
}

function isWikipediaUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "wikipedia.org"
            || host.endsWith(".wikipedia.org");
    } catch (e) {
        return false;
    }
}

function isMetacriticUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "metacritic.com"
            || host.endsWith(".metacritic.com");
    } catch (e) {
        return false;
    }
}
