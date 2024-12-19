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
