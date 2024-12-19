import * as cheerio from 'cheerio';
import OpenAI from "openai";
import {OPEN_API_API_KEY, MAX_DEPTH, DB_STRING} from '../config';
import {parseArtists} from "./parse";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import postgres from 'postgres';
import {Artist, DBArtist} from 'artists/artist';

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY
});

const db = postgres(DB_STRING);

const logger = winston.createLogger({
    transports: [new DailyRotateFile({
        filename: 'logs/%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
    }),
    new winston.transports.Console()]
})

let artistQueue:Artist[] = [];

export async function scrape() {
    const [nextArtist]: [DBArtist?] = await db`
    SELECT * FROM artists
    WHERE foundpeers = false LIMIT 1
    `

    if (!nextArtist) {
        return;
    }

    const artist = translateDBArtist(nextArtist);

    console.log(artist.url);

    const [persistedArtist]: [DBArtist?] = await db`
    SELECT * FROM artists
    WHERE wikilink = (${artist.url})::text LIMIT 1
    `


    if (persistedArtist && persistedArtist.foundpeers) {
        return;
    }

    const children = await getChildren(artist);

    for (const child of children) {
        console.log(children);
        console.log("persisting child: " + child);
        try {
            await db`
                insert into artists
                    (artistname, wikilink, parent_wikilink)
                VALUES (${child.name}::text, ${child.url}::text, ${child.graph.parentUrl}::text)
            `
        } catch(e) {
            console.log("error persisting child: " + e);
        }
    }

    await db`
        UPDATE artists SET foundpeers = true WHERE wikilink = ${artist.url}
    `

    await scrape();
}

async function getChildren(artist:Artist): Promise<Artist[]> {
    logger.info("fetching: " + artist.url);
    let $;
    try {
        $ = await cheerio.fromURL(artist.url);
    } catch (e: any) {
        if (e.status == 404) {
            console.log("deleting: " + artist.url);
            await db`DELETE FROM artists where wikilink = ${artist.url}`
        }
        return [];
    }

    let base: string = '#mw-content-text div';
    let p: string = 'p';
    let content: string = $(base).children(p).text();

    const response = await openai.chat.completions.create({
        messages: [
            {
                role: "user",
                content: `give me wikipedia page links to the bands listed in this article \n ${content}`,
            },
        ],
        model: "gpt-4o",
    });

    if (!response || !response.choices || !response.choices[0]!.message) {
        return [];
    }

    logger.info('ai response: ' + response.choices[0].message.content!.toString());

    let artists: Artist[] = parseArtists(response.choices[0].message.content!.toString(), artist);

    logger.info('parsed artists: ' + JSON.stringify(artists));

    return artists;
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
