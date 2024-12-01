import * as cheerio from 'cheerio';
import OpenAI from "openai";
import {OPEN_API_API_KEY} from './config.ts';

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY
});

export async function scrape(url: string, depth: number) {
    console.log("fetching " + url);
    const $ = await cheerio.fromURL(url);

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

    let artists = parseArtists(response.choices[0].message.content.toString(), depth);
    // let artists = parseArtists(testContents, depth);

    console.log(artists);

    for (const artist of artists) {
        scrape(artist.url, artist.graph.depth);
    }
}

interface Artist {
    name: string
    url: string
    graph: {
        depth: number
    }
}

function parseArtists(rawContents: string, depth: number): [Artist]|null {
    let pattern = /\[(.+)\]\((.+)\)/g

    let matches = [...rawContents.matchAll(pattern)];

    if (!matches) {
        return null;
    }

    return matches.filter(function(m) {
        return m[2].startsWith("https");
    }).
    map(function(m) {
        return {
            name: m[1],
            url: m[2],
            graph: {
                depth: depth+1
            }
        }
    })
}


let testContents = 'Certainly! Here are the Wikipedia page links to the bands mentioned in the article:\n' +
'\n' +
'1. **Nirvana**: [Nirvana (band)](https://en.wikipedia.org/wiki/Nirvana_(band))\n' +
'2. **Melvins**: [Melvins](https://en.wikipedia.org/wiki/Melvins)\n' +
'3. **Creedence Clearwater Revival**: [Creedence Clearwater Revival](https://en.wikipedia.org/wiki/Creedence_Clearwater_Revival)\n' +
'4. **Mudhoney**: [Mudhoney](https://en.wikipedia.org/wiki/Mudhoney)\n' +
'5. **Black Sabbath**: [Black Sabbath](https://en.wikipedia.org/wiki/Black_Sabbath)\n' +
'6. **The Jesus Lizard**: [The Jesus Lizard](https://en.wikipedia.org/wiki/The_Jesus_Lizard)\n' +
'7. **Soundgarden**: [Soundgarden](https://en.wikipedia.org/wiki/Soundgarden)\n' +
'8. **Alice in Chains**: [Alice in Chains](https://en.wikipedia.org/wiki/Alice_in_Chains)\n' +
'9. **Sonic Youth**: [Sonic Youth](https://en.wikipedia.org/wiki/Sonic_Youth)\n' +
'10. **The Breeders**: [The Breeders](https://en.wikipedia.org/wiki/The_Breeders)\n' +
'11. **The Germs**: [Germs (band)](https://en.wikipedia.org/wiki/Germs_(band))\n' +
'12. **Meat Puppets**: [Meat Puppets](https://en.wikipedia.org/wiki/Meat_Puppets)\n' +
'13. **Foo Fighters**: [Foo Fighters](https://en.wikipedia.org/wiki/Foo_Fighters)\n' +
'14. **Pixies**: [Pixies (band)](https://en.wikipedia.org/wiki/Pixies_(band))\n' +
'15. **R.E.M.**: [R.E.M.](https://en.wikipedia.org/wiki/R.E.M.)\n' +
'\n' +
'If there are any other details or specific bands you need further information on, feel free to ask!';
