import * as cheerio from 'cheerio';
import OpenAI from "openai";
import {OPEN_API_API_KEY, MAX_DEPTH} from '../config.ts';
import {parseArtists} from "./parse";
import Artist from '/artists/artist.d.ts';

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY
});

const artistQueue:Artist[] = [];

export async function scrape(artist:Artist) {
    if (artist.graph.depth > MAX_DEPTH) {
        return;
    }

    console.log("fetching " + artist.url);
    const $ = await cheerio.fromURL(artist.url);

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

    console.log(response.choices[0].message.content.toString());

    let artists: Artist[]  = parseArtists(response.choices[0].message.content.toString(), artist.graph.depth);

    console.log(artists);

    for (const artist of artists) {
        artistQueue.push(artist);
    }

    let newArtist = artistQueue.shift();
    await scrape(newArtist);
}
