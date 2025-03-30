import * as cheerio from 'cheerio';
import OpenAI from "openai";
import {OPEN_API_API_KEY, MAX_DEPTH, DB_STRING} from '../../config';
import {parseArtists} from "./parse";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import {Artist, DBArtist} from 'app/artists/artist';
import artists from 'app/repositories/artists/artists'
import {getArtistLinksFromContent} from "./chat";

const logger = winston.createLogger({
    transports: [new DailyRotateFile({
        filename: 'logs/%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
    }),
    new winston.transports.Console()]
})

export async function scrape() {
    const nextArtist = await artists.nextInQueue();

    if (!nextArtist) {
        return;
    }

    const artist = translateDBArtist(nextArtist);

    console.log(artist.url);

    const persistedArtist = await artists.getArtistByUrl(artist.url);

    if (persistedArtist && persistedArtist.found_peers) {
        return;
    }

    const children = await getChildren(artist);

    console.log(children);

    for (const child of children) {
        try {
            await artists.insertNew(child.name, child.url, child.graph.parentUrl);
            console.log("saved new artist: " + JSON.stringify(child));
        } catch(e) {
            // console.log("error persisting child: " + e);
        }
    }

    await artists.markAsPeersFound(artist.url);

    await scrape();
}

async function getChildren(artist:Artist): Promise<Artist[]> {
    let response;
    try {
        response = await getArtistPeersFromUrl(artist.url);
    } catch (e: any) {
        if (e.status == 404) {
            console.log("deleting: " + artist.url);
            artists.delete(artist.url);
            return [];
        }
        console.log("error" + e);
        throw e;
    }

    logger.info('ai response: ' + response);

    let extractedArtists: Artist[] = parseArtists(response, artist);

    logger.info('parsed artists: ' + JSON.stringify(extractedArtists));

    return extractedArtists;
}

export async function getArtistPeersFromUrl(artistUrl: string) {
    logger.info("fetching: " + artistUrl);

    let $;
        $ = await cheerio.fromURL(artistUrl);


    let base: string = '#mw-content-text div';
    let p: string = 'p';
    let content: string = $(base).children(p).text();

    return await getArtistLinksFromContent(content);
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
