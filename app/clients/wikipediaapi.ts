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
    const rawProducer = getInfoboxValue(wikitext, "producer") || getInfoboxValue(wikitext, "producers");
    const artistNames = parseArtistNames(rawArtist);
    const {year, month, day} = parseReleaseDate(releasedRaw);
    const reviewEvidence = collectReviewEvidence(wikitext);
    const reviewLinksCsv = reviewEvidence.links.join(", ");
    const numberOfReviews = reviewEvidence.count;
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
        producer: normalizeListValue(rawProducer),
        studio: normalizeListValue(getInfoboxValue(wikitext, "studio")),
        type: normalizeValue(getInfoboxValue(wikitext, "type")),
        label: normalizeLabelValue(getInfoboxValue(wikitext, "label")),
        original_labels_text: getInfoboxValue(wikitext, "label"),
        original_categories_text: normalizeCategoryTitles(page.categories ?? []),
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
    const requestTimeoutMs = 30000;
    let attempt = 0;

    while (true) {
        attempt += 1;
        let response: Response;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            response = await fetch(url, {
                headers: {
                    "User-Agent": "MoosicGraffBot/2.0 (https://github.com/dallincoons/moosicgraff; contact: dallincoons@gmail.com)",
                },
                signal: controller.signal,
            });
        } catch (e) {
            if (attempt >= maxAttempts) {
                throw e;
            }

            const sleepMs = computeRetryDelayMs(attempt, NaN);
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`[wiki-api] fetch error for "${pageTitle}" attempt ${attempt}/${maxAttempts}: ${message}; retrying in ${sleepMs}ms`);
            await sleep(sleepMs);
            continue;
        } finally {
            clearTimeout(timeout);
        }

        if (response.status !== 429 || attempt >= maxAttempts) {
            return response;
        }

        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
        const sleepMs = computeRetryDelayMs(attempt, retryAfterSeconds);

        console.warn(`[wiki-api] 429 for "${pageTitle}" attempt ${attempt}/${maxAttempts}; retrying in ${sleepMs}ms`);
        await sleep(sleepMs);
    }
}

function computeRetryDelayMs(attempt: number, retryAfterSeconds: number): number {
    const backoffMs = Number.isNaN(retryAfterSeconds)
        ? Math.min(1000 * Math.pow(2, attempt - 1), 15000)
        : retryAfterSeconds * 1000;
    const jitterMs = Math.floor(Math.random() * 500);
    return backoffMs + jitterMs;
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
    const normalized = (title || "").replace(/_/g, " ");
    try {
        return decodeURIComponent(normalized).trim();
    } catch (e) {
        // Some pages contain malformed percent encodings in titles/links; keep raw normalized text.
        return normalized.trim();
    }
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
    const fieldRegex = new RegExp(`^[ \\t]*\\|[ \\t]*${field}[ \\t]*=[ \\t]*(.*)$`, "i");
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
        if (/^[ \t]*\|/.test(line)) {
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
    normalizeWikiTitle,
    normalizeListValue,
    normalizeLabelValue,
    normalizeCategoryTitles,
    getInfoboxValue,
    collectReviewEvidence,
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
        .replace(/\r/g, "");

    const items = replaceTopLevelPipesWithNewlines(listLike)
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
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

function normalizeCategoryTitles(categories: Array<{ title?: string }>): string {
    const items = categories
        .map((category) => (category.title || "").trim())
        .filter((title) => title.length > 0)
        .map((title) => title.replace(/^Category:/i, "").trim())
        .filter((title) => title.length > 0);

    return [...new Set(items)].join(", ");
}

function normalizeTupleSeconds(line: string): string[] {
    const tupleRegex = /\[\[([^|\]]+?),\s*([^\]]+?)]]/g;
    const tupleNormalized = line.replace(tupleRegex, "$1");

    return tupleNormalized
        .split(/\s*,\s*|\s+\*\s+/)
        .map((part) => part.replace(/\[\[([^|\]]+?)(?:\|([^\]]+))?]]/g, (_, target: string, display?: string) => display || target))
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

function replaceTopLevelPipesWithNewlines(value: string): string {
    let linkDepth = 0;
    let out = "";

    for (let i = 0; i < value.length; i++) {
        const pair = value.slice(i, i + 2);
        if (pair === "[[") {
            linkDepth += 1;
            out += pair;
            i += 1;
            continue;
        }
        if (pair === "]]") {
            linkDepth = Math.max(0, linkDepth - 1);
            out += pair;
            i += 1;
            continue;
        }

        if (value[i] === "|" && linkDepth === 0) {
            out += "\n";
            continue;
        }

        out += value[i];
    }

    return out;
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

function collectReviewEvidence(wikitext: string): { links: string[]; count: number } {
    const links = new Set<string>();
    const ratingOutlets = new Set<string>();
    const criticalOutlets = new Set<string>();
    const ratingsBlocks = extractNamedTemplates(wikitext, new Set(["album ratings", "music ratings"]));

    for (const block of ratingsBlocks) {
        const filteredRatingsBlock = stripAggregateScoresFromRatingsBlock(block);
        addLinksToSet(filteredRatingsBlock, links);
        addRatingsRowOutletsToSet(filteredRatingsBlock, ratingOutlets);
    }

    const proseSections = [
        extractSection(wikitext, "critical reception", false),
        extractSection(wikitext, "reception", false),
    ].filter((section) => section.trim().length > 0);
    for (const section of proseSections) {
        addLinksToSet(section, links);
        addCiteOutletFieldsToSet(section, criticalOutlets);
    }

    const countedOutlets = new Set<string>();
    const combinedOutlets = new Set<string>([...ratingOutlets, ...criticalOutlets]);

    for (const outlet of combinedOutlets) {
        const reliability = classifyOutletKey(outlet);
        if (reliability !== "unreliable") {
            addOutletKey(countedOutlets, outlet);
        }
    }

    if (countedOutlets.size === 0) {
        for (const url of links) {
            const outlet = extractOutletFromUrl(url);
            if (!outlet) {
                continue;
            }
            const urlReliability = classifyReviewUrl(url);
            if (urlReliability !== "unreliable" && classifyOutletKey(outlet) !== "unreliable") {
                addOutletKey(countedOutlets, outlet);
            }
        }
    }

    const count = countedOutlets.size;

    return {
        links: prioritizeReviewLinks([...links]),
        count,
    };
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

function extractSection(wikitext: string, sectionName: string, includeSubsections: boolean = true): string {
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

            if (capture && (level <= headingLevel || (!includeSubsections && level > headingLevel))) {
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
        const url = normalizeReviewUrl(externalMatch[1]);
        if (isAllowedReviewUrl(url)) {
            target.add(url);
        }
    }

    const citeUrlRegex = /\|\s*url\s*=\s*(https?:\/\/[^\s|}]+)/gi;
    let citeMatch: RegExpExecArray | null;
    while ((citeMatch = citeUrlRegex.exec(content)) !== null) {
        const url = normalizeReviewUrl(citeMatch[1]);
        if (isAllowedReviewUrl(url)) {
            target.add(url);
        }
    }
}

function addCiteOutletFieldsToSet(content: string, target: Set<string>): void {
    const outletFieldRegex = /\|\s*(?:website|work|magazine|newspaper|publication|journal)\s*=\s*(\[\[[^\]]+]]|[^\n|}]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = outletFieldRegex.exec(content)) !== null) {
        const key = normalizeOutletKey(match[1] || "");
        if (key && !isBlockedAggregatorOutlet(key)) {
            addOutletKey(target, key);
        }
    }
}

function addRatingsRowOutletsToSet(content: string, target: Set<string>): void {
    const ratingsOutletRegex = /\|\s*rev(\d+)\s*=\s*([^\n]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = ratingsOutletRegex.exec(content)) !== null) {
        const numeric = (match[1] || "").trim();
        const key = normalizeOutletKey(match[2] || "");
        if (key && !isBlockedAggregatorOutlet(key)) {
            addOutletKey(target, key);
            continue;
        }
        if (numeric) {
            addOutletKey(target, `review ${numeric}`);
        }
    }
}

function normalizeReviewUrl(url: string): string {
    return (url || "").trim().replace(/[.,;:!?]+$/, "");
}

function extractOutletFromUrl(url: string): string {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        const withoutWww = hostname.replace(/^www\./, "");
        const parts = withoutWww.split(".").filter(Boolean);
        if (parts.length === 0) {
            return "";
        }
        const core = extractCoreDomainLabel(parts);
        return normalizeOutletKey(core);
    } catch (e) {
        return "";
    }
}

function extractCoreDomainLabel(parts: string[]): string {
    if (parts.length < 2) {
        return parts[0] || "";
    }

    // Handle ccTLD patterns like abc.net.au, foo.co.uk, etc.
    if (parts.length >= 3) {
        const tld = parts[parts.length - 1];
        const secondLevel = parts[parts.length - 2];
        const commonSecondLevelDomains = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);
        if (tld.length === 2 && commonSecondLevelDomains.has(secondLevel)) {
            return parts[parts.length - 3];
        }
    }

    return parts[parts.length - 2];
}

function addOutletKey(target: Set<string>, rawKey: string): void {
    const key = normalizeOutletKey(rawKey);
    if (!key) {
        return;
    }

    const normalizedKey = canonicalOutletCompareKey(key);
    for (const existing of target) {
        const normalizedExisting = canonicalOutletCompareKey(existing);
        if (!normalizedExisting || !normalizedKey) {
            continue;
        }
        const shorterLength = Math.min(normalizedExisting.length, normalizedKey.length);
        if (shorterLength < 4) {
            continue;
        }
        if (
            normalizedExisting === normalizedKey
            || normalizedExisting.includes(normalizedKey)
            || normalizedKey.includes(normalizedExisting)
        ) {
            return;
        }
    }

    target.add(key);
}

function hasMatchingOutlet(target: Set<string>, rawKey: string): boolean {
    const key = normalizeOutletKey(rawKey);
    if (!key) {
        return false;
    }
    const normalizedKey = canonicalOutletCompareKey(key);
    for (const existing of target) {
        const normalizedExisting = canonicalOutletCompareKey(existing);
        if (!normalizedExisting || !normalizedKey) {
            continue;
        }
        const shorterLength = Math.min(normalizedExisting.length, normalizedKey.length);
        const existingAcronym = acronymFromOutlet(existing);
        const keyAcronym = acronymFromOutlet(key);
        if (
            (existingAcronym && existingAcronym === normalizedKey)
            || (keyAcronym && keyAcronym === normalizedExisting)
            || (existingAcronym && keyAcronym && existingAcronym === keyAcronym)
        ) {
            return true;
        }
        if (shorterLength < 4) {
            continue;
        }
        if (
            normalizedExisting === normalizedKey
            || normalizedExisting.includes(normalizedKey)
            || normalizedKey.includes(normalizedExisting)
        ) {
            return true;
        }
    }
    return false;
}

function stripCommonOutletSuffixes(value: string): string {
    return (value || "")
        .replace(/\b(magazine|music|news|media|review|reviews|online)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function canonicalOutletCompareKey(value: string): string {
    return stripCommonOutletSuffixes(value)
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}

function acronymFromOutlet(value: string): string {
    const tokens = normalizeOutletKey(value)
        .split(" ")
        .filter((token) => token.length > 0);
    if (tokens.length < 2) {
        return "";
    }
    return tokens.map((token) => token[0]).join("");
}

function normalizeOutletKey(value: string): string {
    const cleaned = stripWikiMarkup(value)
        .toLowerCase()
        .replace(/&amp;/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    return cleaned;
}

function stripWikiMarkup(value: string): string {
    let out = value || "";
    out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ");
    out = out.replace(/<ref[^\/]*\/>/gi, " ");
    out = out.replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, "$2");
    out = out.replace(/\[\[([^\]]+)]]/g, "$1");
    out = out.replace(/\{\{[^{}]*}}/g, " ");
    out = out.replace(/'''+/g, "");
    out = out.replace(/<[^>]+>/g, " ");
    out = out.replace(/\s+/g, " ");
    return out.trim();
}

type ReviewSourceReliability = "reliable" | "unreliable" | "unknown";

const RELIABLE_OUTLET_KEYS = new Set<string>([
    "allmusic",
    "alternative press",
    "american songwriter",
    "attitude",
    "audio culture",
    "the a v club",
    "au review",
    "bandcamp daily",
    "bbc music",
    "beats per minute",
    "billboard",
    "blabbermouth",
    "brooklynvegan",
    "business insider",
    "clash",
    "classic rock",
    "complex",
    "consequence",
    "country weekly",
    "decibel",
    "diy",
    "drowned in sound",
    "entertainment weekly",
    "exclaim",
    "fact",
    "fader",
    "flood",
    "gigwise",
    "goldmine",
    "hot press",
    "independent",
    "kerrang",
    "line of best fit",
    "louder than war",
    "loudwire",
    "metal hammer",
    "mixmag",
    "mojo",
    "musicomh",
    "new noise magazine",
    "nme",
    "npr music",
    "paste",
    "pitchfork",
    "popmatters",
    "punknews",
    "q",
    "quietus",
    "rapreviews",
    "record collector",
    "resident advisor",
    "revolver",
    "rock sound",
    "rolling stone",
    "slant magazine",
    "source",
    "spectrum culture",
    "spin",
    "sputnikmusic",
    "stereogum",
    "taste of country",
    "tiny mix tapes",
    "uncut",
    "under the radar",
    "ultimate guitar",
    "vibe",
    "wire",
    "xxl",
]);

const UNRELIABLE_OUTLET_KEYS = new Set<string>([
    "accesswire",
    "acclaimed music",
    "album of the year",
    "amazon",
    "business wire",
    "businesswire",
    "discogs",
    "einnews",
    "fandom",
    "forbes contributor",
    "huffpost contributor",
    "imdb",
    "globe newswire",
    "globenewswire",
    "issuewire",
    "last fm",
    "medium",
    "newswire",
    "official website",
    "official site",
    "press release",
    "pr newswire",
    "prnewswire",
    "rate your music",
    "setlist fm",
    "songfacts",
    "whosampled",
    "youtube",
    "facebook",
    "instagram",
    "twitter",
    "x com",
    "soundcloud",
]);

const RELIABLE_REVIEW_HOSTS = new Set<string>([
    "allmusic.com",
    "altpress.com",
    "americansongwriter.com",
    "avclub.com",
    "bbc.co.uk",
    "bbc.com",
    "billboard.com",
    "blabbermouth.net",
    "brooklynvegan.com",
    "businessinsider.com",
    "clashmusic.com",
    "consequence.net",
    "decibelmagazine.com",
    "diymag.com",
    "exclaim.ca",
    "floodmagazine.com",
    "kerrang.com",
    "lineofbestfit.com",
    "loudandquiet.com",
    "loudersound.com",
    "loudwire.com",
    "mixmag.net",
    "nme.com",
    "npr.org",
    "pastemagazine.com",
    "pitchfork.com",
    "popmatters.com",
    "punknews.org",
    "quietus.com",
    "rapreviews.com",
    "rollingstone.com",
    "slantmagazine.com",
    "spin.com",
    "spectrumculture.com",
    "sputnikmusic.com",
    "stereogum.com",
    "thefader.com",
    "theguardian.com",
    "thelineofbestfit.com",
    "thequietus.com",
    "tinymixtapes.com",
    "uncut.co.uk",
    "undertheradarmag.com",
    "ultimate-guitar.com",
    "vibe.com",
    "xxlmag.com",
]);

const UNRELIABLE_REVIEW_HOSTS = new Set<string>([
    "45cat.com",
    "acclaimedmusic.net",
    "albumoftheyear.org",
    "amazon.com",
    "amzn.to",
    "accesswire.com",
    "businesswire.com",
    "discogs.com",
    "einnews.com",
    "fandom.com",
    "forbes.com",
    "globenewswire.com",
    "huffpost.com",
    "imdb.com",
    "itunes.apple.com",
    "issuewire.com",
    "last.fm",
    "medium.com",
    "prnewswire.com",
    "rateyourmusic.com",
    "setlist.fm",
    "songfacts.com",
    "whosampled.com",
    "youtube.com",
    "youtu.be",
    "newswire.com",
]);

function classifyReviewUrl(url: string): ReviewSourceReliability {
    if (!isAllowedReviewUrl(url)) {
        return "unreliable";
    }

    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        const path = parsed.pathname.toLowerCase();
        if (matchesHostList(host, UNRELIABLE_REVIEW_HOSTS)) {
            // Forbes and HuffPost can be reliable for staff pieces; block only known contributor patterns.
            if (host === "forbes.com" || host.endsWith(".forbes.com")) {
                const path = parsed.pathname.toLowerCase();
                if (path.startsWith("/sites/") || path.includes("/contributors/")) {
                    return "unreliable";
                }
                return "unknown";
            }
            if (host === "huffpost.com" || host.endsWith(".huffpost.com")) {
                const path = parsed.pathname.toLowerCase();
                if (path.includes("/entry/") || path.includes("/author/")) {
                    return "unreliable";
                }
                return "unknown";
            }
            return "unreliable";
        }
        if (matchesHostList(host, RELIABLE_REVIEW_HOSTS)) {
            return "reliable";
        }

        if (path.includes("press-release") || path.includes("pressrelease")) {
            return "unreliable";
        }
        return "unknown";
    } catch (e) {
        return "unknown";
    }
}

function classifyOutletKey(key: string): ReviewSourceReliability {
    if (isBlockedAggregatorOutlet(key)) {
        return "unreliable";
    }
    if (outletKeyMatchesList(key, UNRELIABLE_OUTLET_KEYS)) {
        return "unreliable";
    }
    if (outletKeyMatchesList(key, RELIABLE_OUTLET_KEYS)) {
        return "reliable";
    }
    return "unknown";
}

function outletKeyMatchesList(key: string, knownOutlets: Set<string>): boolean {
    const normalizedKey = canonicalOutletCompareKey(key);
    if (!normalizedKey) {
        return false;
    }
    for (const candidate of knownOutlets) {
        const normalizedCandidate = canonicalOutletCompareKey(candidate);
        if (!normalizedCandidate) {
            continue;
        }
        const shorterLength = Math.min(normalizedKey.length, normalizedCandidate.length);
        if (shorterLength < 4) {
            continue;
        }
        if (
            normalizedKey === normalizedCandidate
            || normalizedKey.includes(normalizedCandidate)
            || normalizedCandidate.includes(normalizedKey)
        ) {
            return true;
        }
    }
    return false;
}

function matchesHostList(host: string, hosts: Set<string>): boolean {
    for (const candidate of hosts) {
        if (host === candidate || host.endsWith(`.${candidate}`)) {
            return true;
        }
    }
    return false;
}

function prioritizeReviewLinks(urls: string[]): string[] {
    const reliable: string[] = [];
    const unknown: string[] = [];

    for (const url of urls) {
        const reliability = classifyReviewUrl(url);
        if (reliability === "reliable") {
            reliable.push(url);
            continue;
        }
        if (reliability === "unknown") {
            unknown.push(url);
        }
    }

    const ordered = reliable.length > 0 ? [...reliable, ...unknown] : unknown;
    return [...new Set(ordered)];
}

function isAllowedReviewUrl(url: string): boolean {
    if (isWikipediaUrl(url)) {
        return false;
    }
    if (isMetacriticUrl(url)) {
        return false;
    }
    if (isAnyDecentMusicUrl(url)) {
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

function isAnyDecentMusicUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "anydecentmusic.com"
            || host.endsWith(".anydecentmusic.com");
    } catch (e) {
        return false;
    }
}

function isBlockedAggregatorOutlet(key: string): boolean {
    const normalized = normalizeOutletKey(key);
    const compact = normalized.replace(/[^a-z0-9]+/g, "");
    return compact.includes("metacritic") || compact.includes("anydecentmusic");
}

function stripAggregateScoresFromRatingsBlock(block: string): string {
    const lines = block.split("\n");
    const kept: string[] = [];
    let inAggregateSection = false;

    for (const line of lines) {
        const normalized = normalizeOutletKey(line);
        const compact = normalized.replace(/[^a-z0-9]+/g, "");

        if (compact.includes("aggregatescores")) {
            inAggregateSection = true;
            continue;
        }
        if (compact.includes("reviewscores") || compact.includes("professionalratings")) {
            inAggregateSection = false;
        }

        if (inAggregateSection && /^\|\s*rev\d+\s*=/i.test(line)) {
            continue;
        }
        if (inAggregateSection && /^\|\s*rev\d+score\s*=/i.test(line)) {
            continue;
        }

        if (isBlockedAggregatorOutlet(line)) {
            continue;
        }

        kept.push(line);
    }

    return kept.join("\n");
}
