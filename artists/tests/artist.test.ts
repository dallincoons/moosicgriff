import { parseArtists } from 'artists/parse'

const emptyArtist = {
    name: "",
    url: "",
    graph: {
        parentUrl: "",
        depth: 0,
    }
}

let testContent = 'Certainly! Here are the Wikipedia page links to the bands mentioned in the article:\n' +
    '\n' +
    '1. **Nirvana**: [Nirvana (band)](https://en.wikipedia.org/wiki/Nirvana_(band))\n' +
    '2. **Melvins**: [Melvins](https://en.wikipedia.org/wiki/Melvins)\n' +
    '4. **Mudhoney**: [Mudhoney (American band)](https://en.wikipedia.org/wiki/Mudhoney)\n' +
    '5. **Black Sabbath**: [Black Sabbath - Wikipedia](https://en.wikipedia.org/wiki/Black_Sabbath)\n' +
    // '6. **The Jesus Lizard**: [The Jesus Lizard](https://en.wikipedia.org/wiki/The_Jesus_Lizard)\n' +
    // '7. **Soundgarden**: [Soundgarden](https://en.wikipedia.org/wiki/Soundgarden)\n' +
    // '8. **Alice in Chains**: [Alice in Chains](https://en.wikipedia.org/wiki/Alice_in_Chains)\n' +
    // '9. **Sonic Youth**: [Sonic Youth](https://en.wikipedia.org/wiki/Sonic_Youth)\n' +
    // '10. **The Breeders**: [The Breeders](https://en.wikipedia.org/wiki/The_Breeders)\n' +
    // '11. **The Germs**: [Germs (band)](https://en.wikipedia.org/wiki/Germs_(band))\n' +
    // '12. **Meat Puppets**: [Meat Puppets](https://en.wikipedia.org/wiki/Meat_Puppets)\n' +
    // '13. **Foo Fighters**: [Foo Fighters](https://en.wikipedia.org/wiki/Foo_Fighters)\n' +
    // '14. **Pixies**: [Pixies (band)](https://en.wikipedia.org/wiki/Pixies_(band))\n' +
    // '15. **R.E.M.**: [R.E.M.](https://en.wikipedia.org/wiki/R.E.M.)\n' +
    '\n' +
    'If there are any other details or specific bands you need further information on, feel free to ask!';

describe("artist link parsing", () => {
    it("pull out band names and URLs", () => {
        expect(parseArtists(testContent, emptyArtist)).toEqual([
            {name: "Nirvana", url: "https://en.wikipedia.org/wiki/Nirvana_(band)", graph: {depth: 1}},
            {name: "Melvins", url: "https://en.wikipedia.org/wiki/Melvins", graph: {depth: 1}},
            {name: "Mudhoney", url: "https://en.wikipedia.org/wiki/Mudhoney", graph: {depth: 1}},
            {name: "Black Sabbath", url: "https://en.wikipedia.org/wiki/Black_Sabbath", graph: {depth: 1}},
        ]);
    });
});

