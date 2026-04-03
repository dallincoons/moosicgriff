import {getHtml} from "app/clients/wikipedia";
import * as cheerio from "cheerio";

export async function getArtistLinksFromContent(content: string): Promise<string> {
    const { default: openai } = await import("app/clients/openai");
    const response = await openai.chat.completions.create({
        messages: [
            {
                role: "user",
                content: `give me wikipedia page links to the solo artists and bands listed in this article who have a discography (but don't include the discography page) \n Respond in this format: **band name**: [band name](link to wikipedia page) \n ${content}`,
            },
        ],
        model: "gpt-4o",
    });

    if (!response || !response.choices || !response.choices[0]!.message) {
        return "";
    }

    return response.choices[0].message.content!.toString();
}

export async function getBandName(link: string): Promise<string> {
    try {
        let html = await getHtml(link);
        const urlIndicatesBand = /\(band\)/i.test(decodeURIComponent(link));
        const isMusicPage = isLikelyMusicArtistPage(link, html);
        if (!isMusicPage && !urlIndicatesBand) return '';

        const match = html.match(/<title>(.*?) - Wikipedia<\/title>/);
        if (match && match[1]) {
            let bandName = match[1];
            const normalized = bandName.replace(/\s*\(.*?\)\s*$/, '');
            return normalized;
        }

        if (urlIndicatesBand) {
            return getNameFromUrl(link);
        }

        return '';
    } catch (e) {
        console.log("failed to get band name. " + e);
        if (/\(band\)/i.test(decodeURIComponent(link))) {
            return getNameFromUrl(link);
        }
        return '';
    }
}

function isLikelyMusicArtistPage(link: string, html: string): boolean {
    const $ = cheerio.load(html);
    const decodedLink = decodeURIComponent(link).toLowerCase();
    const titleText = normalizePageTitle(($("title").first().text() || "").toLowerCase());

    const isClearlyNonArtistPage = [
        "/wiki/list_of_",
        "festival",
        "awards",
        "music_festival",
    ].some((signal) => decodedLink.includes(signal))
        || [
            "list of ",
            " festival",
            " awards",
        ].some((signal) => titleText.includes(signal));

    if (isClearlyNonArtistPage) {
        return false;
    }

    const categoryText = $("#mw-normal-catlinks, #catlinks")
        .text()
        .toLowerCase();

    const hasMusicCategory = [
        "musicians",
        "singers",
        "rappers",
        "songwriters",
        "record producers",
        "djs",
        "composers",
        "musical groups",
        "bands",
        "music duos",
        "music groups",
        "vocalists",
    ].some((signal) => categoryText.includes(signal));

    const hasClearlyNonMusicCategory = [
        "lists",
        "festivals",
        "music festivals",
        "musical instruments",
        "string instruments",
        "percussion instruments",
        "keyboard instruments",
        "wind instruments",
        "video games",
        "board games",
        "role-playing games",
        "comics",
        "software",
        "companies",
        "organizations",
        "films",
        "television",
    ].some((signal) => categoryText.includes(signal));

    if (hasMusicCategory) {
        return true;
    }

    if (hasClearlyNonMusicCategory) {
        return false;
    }

    const infobox = $("table.infobox").first();
    if (infobox.length) {
        const infoboxSignals = getMusicInfoboxSignals(infobox.text().toLowerCase());
        // Keep this strict: require multiple artist-specific infobox signals when category data is inconclusive.
        if (infoboxSignals >= 2) {
            return true;
        }
    }
    return false;
}

function getMusicInfoboxSignals(infoboxText: string): number {
    const signals = [
        "associated acts",
        "years active",
        "instruments",
        "members",
        "past members",
        "current members",
    ];
    let matched = 0;
    for (const signal of signals) {
        if (infoboxText.includes(signal)) {
            matched += 1;
        }
    }
    return matched;
}

function normalizePageTitle(value: string): string {
    return value
        .replace(/\s*-\s*wikipedia\s*$/i, "")
        .trim();
}

function getNameFromUrl(link: string): string {
    try {
        const pathname = new URL(link).pathname;
        const page = decodeURIComponent(pathname.replace(/^\/wiki\//, ""));
        return page
            .replace(/_/g, " ")
            .replace(/\s*\(.*?\)\s*$/, "")
            .trim();
    } catch (e) {
        return "";
    }
}
