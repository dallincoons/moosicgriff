import { parseArtists } from 'app/artists/parse'

const emptyArtist = {
    name: "",
    url: "",
    graph: {
        parentUrl: "",
    }
}

let testContent = 'Certainly! Here are the Wikipedia page links to the bands mentioned in the article:\n' +
    '\n' +
    '1. **Nirvana**: [Nirvana (band)](https://en.wikipedia.org/wiki/Nirvana_(band))\n' +
    '2. **Melvins**: [Melvins](https://en.wikipedia.org/wiki/Melvins)\n' +
    '4. **Mudhoney**: [Mudhoney (American band)](https://en.wikipedia.org/wiki/Mudhoney)\n' +
    '5. **Black Sabbath**: [Black Sabbath - Wikipedia](https://en.wikipedia.org/wiki/Black_Sabbath)\n' +
    '6. **The Jesus Lizard**: [https://en.wikipedia.org/wiki/The_Jesus_Lizard](https://en.wikipedia.org/wiki/The_Jesus_Lizard)\n' +
    '9. **Wikipedia - Sonic Youth**: [Sonic Youth](https://en.wikipedia.org/wiki/Sonic_Youth)\n' +
    '10. **The Breeders Wikipedia page**: [The Breeders](https://en.wikipedia.org/wiki/The_Breeders)\n' +
    '11. **The Germs (American band)**: [Germs (band)](https://en.wikipedia.org/wiki/Germs_(American_band))\n' +
    // '12. **Meat Puppets**: [Meat Puppets](https://en.wikipedia.org/wiki/Meat_Puppets)\n' +
    // '13. **Foo Fighters**: [Foo Fighters](https://en.wikipedia.org/wiki/Foo_Fighters)\n' +
    // '14. **Pixies**: [Pixies (band)](https://en.wikipedia.org/wiki/Pixies_(band))\n' +
    // '15. **R.E.M.**: [R.E.M.](https://en.wikipedia.org/wiki/R.E.M.)\n' +
    '\n' +
    'If there are any other details or specific bands you need further information on, feel free to ask!';

describe("artist link parsing", () => {
    it("pull out band names and URLs", () => {
        expect(parseArtists(testContent,
            {name: "Tom Waits", url: "https://en.wikipedia.org/wiki/Tom_Waits", graph: {parentUrl: "",}})
        ).toEqual([
            {name: "Nirvana", url: "https://en.wikipedia.org/wiki/Nirvana_(band)", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "Melvins", url: "https://en.wikipedia.org/wiki/Melvins", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "Mudhoney", url: "https://en.wikipedia.org/wiki/Mudhoney", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "Black Sabbath", url: "https://en.wikipedia.org/wiki/Black_Sabbath", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "The Jesus Lizard", url: "https://en.wikipedia.org/wiki/The_Jesus_Lizard", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "Sonic Youth", url: "https://en.wikipedia.org/wiki/Sonic_Youth", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "The Breeders", url: "https://en.wikipedia.org/wiki/The_Breeders", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
            {name: "Germs", url: "https://en.wikipedia.org/wiki/Germs_(American_band)", graph: {parentUrl: "https://en.wikipedia.org/wiki/Tom_Waits",}},
        ]);
    });
});

