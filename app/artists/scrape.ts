import * as cheerio from 'cheerio';
import OpenAI from "openai";
import {OPEN_API_API_KEY, MAX_DEPTH, DB_STRING} from '../../config';
import {parseArtists} from "./parse";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import {Artist, DBArtist} from 'app/artists/artist';
import artists from 'app/repositories/artists/artists'
import deadlinks from 'app/repositories/deadlinks/deadlinks'
import {getArtistLinksFromContent, getBandName} from "./chat";
import {CheerioAPI} from "cheerio";

const logger = winston.createLogger({
    transports: [new DailyRotateFile({
        filename: 'logs/%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
    }),
    new winston.transports.Console()]
})

export async function handleLink(link: string, parentLink: string = ""): Promise<void> {
    if (await deadlinks.doesDeadLinkExist(link)) {
        // console.log("dead link exists " + link);
        return;
    }

    if (await artists.getArtistByUrl(link)) {
        // console.log("already found: " + link);
        return;
    }

    let bandName = await getBandName(link);

    if (!bandName || bandName == `""`) {
        // console.log("inserting dead link: " + link);
        await deadlinks.insertNew(link);
        return;
    }

    try {
        await artists.insertNew(bandName, link, parentLink);
        console.log("saved new artist: " + link);
    } catch (e) {
        // console.log("error persisting child: " + e);
    }
}

export async function scrape() {
    const nextArtist = await artists.nextInQueue();

    if (!nextArtist) {
        return;
    }

    const artist = translateDBArtist(nextArtist);

    const persistedArtist = await artists.getArtistByUrl(artist.url);

    if (persistedArtist && persistedArtist.found_peers) {
        return;
    }

    const links: string[] = await getChildren(artist);

    for (const link of links) {
        await handleLink(link, artist.url);
    }

    await artists.markAsPeersFound(artist.url);

    await scrape();
}

async function getChildren(artist:Artist): Promise<string[]> {
    // let response;
    try {
        return await getArtistPeersFromUrl(artist.url);
    } catch (e: any) {
        if (e.status == 404) {
            console.log("deleting: " + artist.url);
            artists.delete(artist.url);
            return [];
        }
        console.log("error" + e);
        throw e;
    }
}

export async function getArtistPeersFromUrl(artistUrl: string) {
    logger.info("fetching: " + artistUrl);

    let $: CheerioAPI = await cheerio.fromURL(artistUrl);

    // let base: string = '#mw-content-text div';
    // let p: string = 'p';
    // let content: string = $(base).children(p).text();
    let links: string[] = [];

    $('a[href^="/wiki/"]').each((_, element) => {
        const href = $(element).attr('href');

        if (!href) {
            return;
        }

        // Skip special pages like /wiki/Help: or /wiki/File:
        if (
            !href.includes(':') &&  // exclude /wiki/File:, /wiki/Category:, etc.
            !href.includes('#')     // exclude in-page anchors
        ) {
            links.push('https://en.wikipedia.org' + href);
        }
    })

    return links;
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
