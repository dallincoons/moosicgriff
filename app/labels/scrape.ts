import * as cheerio from "cheerio";
import labels from "app/repositories/labels/labels";
import {Label} from "app/labels/label";
import {getHtml} from "app/clients/wikipedia";

const RECORD_LABEL_INDEX_PAGES = [
    "https://en.wikipedia.org/wiki/List_of_record_labels:_A%E2%80%93H",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_I%E2%80%93Q",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_R%E2%80%93Z",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_0%E2%80%939",
];
const WIKIPEDIA_API_USER_AGENT =
    "MoosicGraffBot/2.0 (https://github.com/dallincoons/moosicgraff; contact: dallincoons@gmail.com)";

type WikiQueryResponse = {
    query?: {
        pages?: Array<{
            missing?: boolean;
            pageid?: number;
            title?: string;
            categories?: Array<{ title?: string }>;
            revisions?: Array<{ content?: string; slots?: { main?: { content?: string } } }>;
        }>;
    };
};

export async function scrape(limitArg?: string): Promise<void> {
    let limit: number | null = null;
    if ((limitArg || "").trim().length > 0) {
        const parsed = parseInt(limitArg as string, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            console.log(`[labels] invalid limit "${limitArg}"`);
            return;
        }
        limit = parsed;
    }

    console.log(`[labels] collecting label links from ${RECORD_LABEL_INDEX_PAGES.length} index pages`);
    const labelLinks = await getRecordLabelLinksFromIndexes(RECORD_LABEL_INDEX_PAGES);
    const selectedLinks = limit ? labelLinks.slice(0, limit) : labelLinks;
    console.log(`[labels] discovered ${labelLinks.length} candidate label pages; scraping ${selectedLinks.length}${limit ? ` (limit=${limit})` : ""}`);

    let processed = 0;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    for (const link of selectedLinks) {
        processed += 1;
        const prefix = `[labels] ${processed}/${selectedLinks.length}`;
        try {
            const label = await getLabelFromApi(link);
            if (!label) {
                skipped += 1;
                console.log(`${prefix} skipped=${link}`);
                continue;
            }

            await labels.upsertLabel(label);
            upserted += 1;
            console.log(`${prefix} upserted="${label.name}"`);
        } catch (e) {
            failed += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(`${prefix} failed=${link} error=${message}`);
        }
    }

    console.log(`[labels] complete processed=${processed} upserted=${upserted} skipped=${skipped} failed=${failed}`);
}

async function getRecordLabelLinksFromIndexes(indexPageUrls: string[]): Promise<string[]> {
    const links = new Set<string>();

    for (let index = 0; index < indexPageUrls.length; index++) {
        const indexPageUrl = indexPageUrls[index];
        console.log(`[labels] index ${index + 1}/${indexPageUrls.length}: ${indexPageUrl}`);
        const html = await getHtml(indexPageUrl);
        const $ = cheerio.load(html);
        const root = $("#mw-content-text .mw-parser-output").first();
        const scopedRoot = root.length ? root : $("body");

        const tableAnchors = scopedRoot.find("table.wikitable a[href^='/wiki/']");
        const listAnchors = scopedRoot.find("ul li a[href^='/wiki/']");
        const candidates = tableAnchors.add(listAnchors);

        let discoveredOnPage = 0;
        candidates.each((_, element) => {
            const href = $(element).attr("href") || "";
            if (!href.startsWith("/wiki/")) {
                return;
            }
            if (href.includes(":") || href.includes("#")) {
                return;
            }
            if (href.includes("/wiki/List_of_record_labels")) {
                return;
            }

            const wikilink = `https://en.wikipedia.org${href}`;
            if (!links.has(wikilink)) {
                discoveredOnPage += 1;
                links.add(wikilink);
            }
        });

        console.log(`[labels] index ${index + 1}/${indexPageUrls.length}: added=${discoveredOnPage} total=${links.size}`);
    }

    return [...links].sort((a, b) => a.localeCompare(b));
}

async function getLabelFromApi(pageUrl: string): Promise<Label | null> {
    const title = getPageTitleFromUrl(pageUrl);
    const apiUrl = getWikiApiUrl(title);
    const response = await fetch(apiUrl, {
        headers: {
            "User-Agent": WIKIPEDIA_API_USER_AGENT,
        },
    });

    const data = (await response.json()) as WikiQueryResponse;
    const page = data.query?.pages?.[0];
    if (!page || page.missing) {
        return null;
    }

    const wikitext = page.revisions?.[0]?.slots?.main?.content || page.revisions?.[0]?.content || "";
    if (!wikitext) {
        return null;
    }

    if (!isLikelyLabelPage(wikitext, page.categories || [])) {
        return null;
    }

    const pageTitle = page.title || title;
    const rawName = getInfoboxValue(wikitext, "name");
    const rawFounded = getInfoboxValue(wikitext, "founded") || getInfoboxValue(wikitext, "established");
    const rawCountry = getInfoboxValue(wikitext, "country") || getInfoboxValue(wikitext, "country_of_origin");
    const rawGenre = getInfoboxValue(wikitext, "genre");
    const rawFounder = getInfoboxValue(wikitext, "founder") || getInfoboxValue(wikitext, "founders");

    return {
        wikilink: buildWikiUrlFromTitle(pageTitle),
        wikipedia_page_id: page.pageid ?? null,
        name: normalizeName(rawName, pageTitle),
        founded: normalizeValue(rawFounded),
        country_of_origin: normalizeListValue(rawCountry),
        genre: normalizeListValue(rawGenre),
        founder: normalizeListValue(rawFounder),
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

function isLikelyLabelPage(wikitext: string, categories: Array<{ title?: string }>): boolean {
    const hasLabelInfobox = /\{\{\s*infobox\s+(?:record label|company|organization)/i.test(wikitext);
    const hasLabelCategory = categories.some((category) => {
        const title = (category.title || "").toLowerCase();
        return title.includes("record labels");
    });
    return hasLabelInfobox || hasLabelCategory;
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
    const start = wikitext.search(/\{\{\s*infobox\s+/i);
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

function normalizeName(rawName: string, pageTitle: string): string {
    const normalizedName = normalizeValue(rawName);
    if (normalizedName) {
        return normalizedName;
    }
    return normalizeWikiTitle(pageTitle)
        .replace(/\s*\((record label|label|company)\)\s*$/i, "")
        .trim();
}

function normalizeWikiTitle(title: string): string {
    const normalized = (title || "").replace(/_/g, " ");
    try {
        return decodeURIComponent(normalized).trim();
    } catch (e) {
        return normalized.trim();
    }
}

function normalizeListValue(value: string): string {
    const normalized = value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\{\{\s*plainlist\s*\|/gi, "")
        .replace(/\{\{\s*flatlist\s*\|/gi, "")
        .replace(/\{\{\s*hlist\s*\|/gi, "")
        .replace(/\}\}/g, "")
        .replace(/\r/g, "");

    const parts = normalized
        .split(/\n+|;|,/)
        .map((part) => normalizeValue(part.replace(/^\*+\s*/, "")))
        .filter((part) => part.length > 0);

    return [...new Set(parts)].join(", ");
}

function normalizeValue(value: string): string {
    return (value || "")
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
        .replace(/<ref[^\/]*\/>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\{\{nowrap\|([^{}]+)}}/gi, "$1")
        .replace(/\{\{start date and age\|([^{}]+)}}/gi, "$1")
        .replace(/\{\{start date\|([^{}]+)}}/gi, "$1")
        .replace(/\{\{birth date and age\|([^{}]+)}}/gi, "$1")
        .replace(/\{\{birth year and age\|([^{}]+)}}/gi, "$1")
        .replace(/\{\{plainlist\|/gi, "")
        .replace(/\{\{flatlist\|/gi, "")
        .replace(/\{\{hlist\|/gi, "")
        .replace(/\{\{unbulleted list\|/gi, "")
        .replace(/\{\{ubl\|/gi, "")
        .replace(/\{\{[^{}]*}}/g, " ")
        .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, "$2")
        .replace(/\[\[([^\]]+)]]/g, "$1")
        .replace(/\[[^\]]*]/g, "")
        .replace(/''+/g, "")
        .replace(/\|/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .replace(/^[-,;\s]+|[-,;\s]+$/g, "")
        .trim();
}
