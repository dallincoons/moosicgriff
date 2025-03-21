import { parseArtists } from 'app/artists/parse'
import {parseReleases} from "../parse";

const emptyArtist = {
    name: "",
    url: "",
    graph: {
        parentUrl: "",
    }
}

let testContent = 'Certainly! Here are the Wikipedia page links to the bands mentioned in the article:\n' +
    '\n' +
    '### Studio Albums\n' +
    '1. - Release name: Bleach\n' +
    '   - Producer: Jack Endino\n' +
    '   - Type of release: Studio Album\n' +
    '   - Label: Sub Pop\n' +
    '   - Year released: 1989\n' +
    '   - Month released: December\n' +
    '   - Day released: 12\n' +
    '   - [Link to Wikipedia page](https://en.wikipedia.org/wiki/Bleach_(Nirvana_album))\n' +
    '\n' +
    '2. - Release name: Nevermind\n' +
    '   - Producer: Butch Vig\n' +
    '   - Type of release: Studio Album\n' +
    '   - Label: DGC\n' +
    '   - Year released: 1991\n' +
    '   - Month released: November\n' +
    '   - Day released: 12\n' +
    '   - [Link to Wikipedia page](https://en.wikipedia.org/wiki/Nevermind_(Nirvana_album))\n' +
    '\n' +
    '### Live Albums\n' +
    '1. - Release name: MTV Unplugged in New York\n' +
    '   - Producer: Scott Litt, Nirvana\n' +
    '   - Type of release: Live Album\n' +
    '   - Labels: DGC, Geffen\n' +
    '   - Year released: 1994\n' +
    '   - Month released: August\n' +
    '   - Day released: 11\n' +
    '   - [Link to Wikipedia page](https://en.wikipedia.org/wiki/MTV_Unplugged_in_New_York)\n' +
    '\n' +
    '2. - Release name: From the Muddy Banks of the Wishkah\n' +
    '   - Producer: Nirvana\n' +
    '   - Type of release: Live Album\n' +
    '   - Labels: DGC, Geffen\n' +
    '   - Year released: 1996\n' +
    '   - Month released: October\n' +
    '   - Day released: 10\n' +
    '   - [Link to Wikipedia page](https://en.wikipedia.org/wiki/From_the_Muddy_Banks_of_the_Wishkah)\n' +
    '\n' +
    '### Compilation Albums\n' +
    '1. - Release name: Incesticide\n' +
    '   - Producer: Various\n' +
    '   - Type of release: Compilation Album\n' +
    '   - Labels: Sub Pop, DGC\n' +
    '   - Year released: 1992\n' +
    '   - Month released: July\n' +
    '   - Day released: 9\n' +
    '   - [Link to Wikipedia page](https://en.wikipedia.org/wiki/Incesticide)\n' +
    '\n' +
    '### Box Sets\n' +
    '1. - Release name: Singles\n' +
    '   - Producer: Various\n' +
    '   - Type of release: Box Set\n' +
    '   - Labels: DGC, Geffen\n' +
    '   - Year released: 1995\n' +
    '   - Month released: December\n' +
    '   - Day released: 12\n' +
    '   - (No dedicated Wikipedia page)\n' +
    '\n' +
    '### Extended Plays\n' +
    '1. - Release name: Blew\n' +
    '   - Producer: Jack Endino\n' +
    '   - Type of release: EP\n' +
    '   - Label: Tupelo\n' +
    '   - Year released: \n' +
    '   - Month released: \n' +
    '   - Day released: \n' +
    '   - (No dedicated Wikipedia page)\n';

describe("discography parsing", () => {
    it("pull out release info", () => {
        expect(parseReleases(testContent)).toEqual([
            {
                name: "Bleach",
                producer: "Jack Endino",
                type: "Studio Album",
                label: "Sub Pop",
                year: 1989,
                day: 12,
                month: "December",
                wikilink: "https://en.wikipedia.org/wiki/Bleach_(Nirvana_album)",
                artist_wikilink: "",
            },
            {
                name: "Nevermind",
                producer: "Butch Vig",
                type: 'Studio Album',
                label: "DGC",
                year: 1991,
                day: 12,
                month: "November",
                wikilink: "https://en.wikipedia.org/wiki/Nevermind_(Nirvana_album)",
                artist_wikilink: "",
            },
            {
                name: "MTV Unplugged in New York",
                producer: "Scott Litt, Nirvana",
                type: 'Live Album',
                label: "DGC, Geffen",
                year: 1994,
                day: 11,
                month: "August",
                wikilink: "https://en.wikipedia.org/wiki/MTV_Unplugged_in_New_York",
                artist_wikilink: "",
            },
            {
                name: "From the Muddy Banks of the Wishkah",
                producer: "Nirvana",
                type: 'Live Album',
                label: "DGC, Geffen",
                year: 1996,
                day: 10,
                month: "October",
                wikilink: "https://en.wikipedia.org/wiki/From_the_Muddy_Banks_of_the_Wishkah",
                artist_wikilink: "",
            },
            {
                name: "Incesticide",
                producer: "Various",
                type: 'Compilation Album',
                label: "Sub Pop, DGC",
                year: 1992,
                day: 9,
                month: "July",
                wikilink: "https://en.wikipedia.org/wiki/Incesticide",
                artist_wikilink: "",
            },
            {
                name: "Singles",
                producer: "Various",
                type: 'Box Set',
                label: "DGC, Geffen",
                year: 1995,
                day: 12,
                month: "December",
                wikilink: "",
                artist_wikilink: "",
            },
            {
                name: "Blew",
                producer: "Jack Endino",
                type: 'EP',
                label: "Tupelo",
                year: null,
                day: null,
                month: "",
                wikilink: "",
                artist_wikilink: "",
            },
        ]);
    });
});
