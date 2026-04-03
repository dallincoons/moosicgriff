import {getHtml, getSectionText, getSectionWikiLinks, isMissingArticlePage, resolveWikipediaPageInfo} from "app/clients/wikipedia";
import {parseArtists} from "./parse";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import {Artist, DBArtist} from 'app/artists/artist';
import artists from 'app/repositories/artists/artists'
import deadlinks from 'app/repositories/deadlinks/deadlinks'
import {getArtistLinksFromContent, getBandName} from "./chat";
import {recordContentHashSkip, recordDeadlinkAdded, recordNewArtist} from "./runsummary";
import {createHash} from "crypto";
import {isStopRequested} from "app/runtime/stop";
import * as cheerio from "cheerio";

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ level, message, timestamp }) => {
            return `\n[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
        }),
    ),
    transports: [new DailyRotateFile({
        filename: 'logs/%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
    }),
    new winston.transports.Console()]
})

const green = "\x1b[32m";
const reset = "\x1b[0m";

export function closeArtistScrapeResources(): void {
    logger.close();
}

export async function handleLink(link: string, parentLink: string = ""): Promise<void> {
    if (await artists.getArtistByUrl(link)) {
        return;
    }

    if (await deadlinks.doesDeadLinkExist(link)) {
        return;
    }

    let bandName = await getBandName(link);
    if (!bandName || bandName == `""`) {
        console.log("inserting dead link: " + link);
        if (isStopRequested()) {
            return;
        }
        await deadlinks.insertNew(link);
        recordDeadlinkAdded();
        return;
    }

    const pageInfo = await resolveWikipediaPageInfo(link);
    const resolvedLink = pageInfo.resolvedUrl;
    const pageId = pageInfo.pageId;

    if (pageInfo.isRedirect && pageInfo.originalUrl !== resolvedLink) {
        console.log(`redirect detected: ${pageInfo.originalUrl} -> ${resolvedLink}`);
    }

    if (pageInfo.isDisambiguation) {
        console.log(`skipping disambiguation page: ${resolvedLink}`);
        return;
    }

    if (resolvedLink !== link) {
        if (await deadlinks.doesDeadLinkExist(resolvedLink)) {
            return;
        }
        if (await artists.getArtistByUrl(resolvedLink)) {
            return;
        }

        const resolvedBandName = await getBandName(resolvedLink);
        if (resolvedBandName && resolvedBandName !== `""`) {
            bandName = resolvedBandName;
        }
    }

    const hasDiscography = await hasDiscographySource(resolvedLink);
    if (!hasDiscography) {
        console.log(`skipping artist without discography source: ${resolvedLink}`);
        if (isStopRequested()) {
            return;
        }
        await deadlinks.insertNew(resolvedLink);
        return;
    }

    if (pageId) {
        const existingByPageId = await artists.getArtistByWikipediaPageId(pageId);
        if (existingByPageId) {
            return;
        }
    }

    try {
        console.log(`${green}inserting new artist: ${bandName}${reset}`);
        if (isStopRequested()) {
            return;
        }
        await artists.insertNew(bandName, resolvedLink, parentLink, pageId);
        recordNewArtist(bandName, resolvedLink);
        console.log(`${green}saved new artist: ${resolvedLink}${reset}`);
    } catch (e) {
        // console.log("error persisting child: " + e);
    }
}

async function hasDiscographySource(artistLink: string): Promise<boolean> {
    const discographyPage = `${artistLink}_discography`;

    if (!(await isMissingArticlePage(discographyPage))) {
        if (await sectionHasDiscographyData(discographyPage, "Albums", "References")) {
            return true;
        }
        if (await sectionHasDiscographyData(discographyPage, "Studio albums", "References")) {
            return true;
        }
        if (await sectionHasDiscographyData(discographyPage, "Discography", "References")) {
            return true;
        }
    }

    if (await sectionHasDiscographyData(artistLink, "Discography", "References")) {
        return true;
    }

    return false;
}

async function sectionHasDiscographyData(url: string, startHeader: string, endHeader: string): Promise<boolean> {
    try {
        const links = await getSectionWikiLinks(url, startHeader, endHeader);
        if (links.length > 0) {
            return true;
        }

        const text = (await getSectionText(url, startHeader, endHeader) || "").trim();
        return text.length > 40;
    } catch (e) {
        return false;
    }
}

export async function scrape(runStartedAt: Date = new Date(), hasProcessedArtists: boolean = false) {
    const nextArtist = await artists.nextInQueue(runStartedAt);

    if (!nextArtist) {
        console.log(hasProcessedArtists ? "No more artists to process." : "No artists to process.");
        return;
    }

    const artist = translateDBArtist(nextArtist);

    const persistedArtist = await artists.getArtistByUrl(artist.url);

    const pageData = await getChildren(artist);
    const pageContentHash = hashContent(pageData.html);

    if (persistedArtist?.page_content_hash && persistedArtist.page_content_hash === pageContentHash) {
        if (isStopRequested()) {
            return;
        }
        console.log(`No page changes detected for ${artist.url}; skipping.`);
        recordContentHashSkip(artist.url);
        await artists.markAsPeersFound(artist.url);
        console.log(`[artists] outcome=hash-skip url=${artist.url}`);
        await scrape(runStartedAt, true);
        return;
    }

    const links: string[] = pageData.links;
    console.log(`[artists] url=${artist.url} candidate_peer_links=${links.length}`);

    for (const link of links) {
        if (isStopRequested()) {
            break;
        }
        await handleLink(link, artist.url);
    }

    if (isStopRequested()) {
        return;
    }
    await artists.updatePageContentHash(artist.url, pageContentHash);
    await artists.markAsPeersFound(artist.url);
    console.log(`[artists] outcome=processed url=${artist.url} links_processed=${links.length}`);

    await scrape(runStartedAt, true);
}

async function getChildren(artist:Artist): Promise<{html: string; links: string[]}> {
    // let response;
    try {
        return await getArtistPageDataFromUrl(artist.url);
    } catch (e: any) {
        if (e.status == 404) {
            console.log("deleting: " + artist.url);
            if (isStopRequested()) {
                return { html: "", links: [] };
            }
            await artists.delete(artist.url);
            return { html: "", links: [] };
        }
        console.log("error" + e);
        throw e;
    }
}

export async function getArtistPeersFromUrl(artistUrl: string) {
    const pageData = await getArtistPageDataFromUrl(artistUrl);
    return pageData.links;
}

async function getArtistPageDataFromUrl(artistUrl: string): Promise<{html: string; links: string[]}> {
    logger.info("fetching: " + artistUrl);

    const html = await getHtml(artistUrl);
    const $ = cheerio.load(html);
    const scopedLinks = new Set<string>();

    const relevantInfoboxRows = $("table.infobox tr").filter((_, row) => {
        const headerText = $(row).children("th").first().text().trim().toLowerCase();
        return [
            "associated acts",
            "members",
            "past members",
            "current members",
            "spinoffs",
            "spin-offs",
        ].includes(headerText);
    });

    relevantInfoboxRows.find('a[href^="/wiki/"]').each((_, anchor) => {
        const href = $(anchor).attr("href");
        const normalized = normalizeWikiLinkHref(href);
        if (normalized) {
            scopedLinks.add(normalized);
        }
    });

    return { html, links: [...scopedLinks] };
}

function normalizeWikiLinkHref(href?: string): string {
    if (!href || !href.startsWith("/wiki/")) {
        return "";
    }

    if (href.includes(":") || href.includes("#")) {
        return "";
    }

    return `https://en.wikipedia.org${href}`;
}

function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

function translateDBArtist(artist:DBArtist): Artist {
    return {
        name: artist.artistname,
        url: artist.wikilink,
        graph: {
            parentUrl: artist.parent_wikilink,
        }
    }
}
