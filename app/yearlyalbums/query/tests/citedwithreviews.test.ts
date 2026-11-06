import {extractCitedAlbumRowsForTesting} from "app/yearlyalbums/query/citedwithreviews";

describe("yearly.albums.cited.reviews row extraction", () => {
    it("keeps cited unlinked album rows so they can be matched by title and artist", () => {
        const html = `
            <table class="wikitable plainrowheaders">
                <tr><th>Release date</th><th>Artist</th><th>Album</th><th>Genre</th><th>Label</th><th>Ref.</th></tr>
                <tr>
                    <th scope="row" rowspan="2">January3</th>
                    <td>Boldy James and RichGains</td>
                    <td><i>Murder During Drug Traffic</i></td>
                    <td></td>
                    <td>Boldy James & RichGains</td>
                    <td><sup class="reference"><a href="#cite_note-1">[1]</a></sup></td>
                </tr>
                <tr>
                    <td>Lil Baby</td>
                    <td><i>WHAM</i></td>
                    <td>Hip-hop</td>
                    <td>Motown</td>
                    <td></td>
                </tr>
            </table>
        `;

        const rows = extractCitedAlbumRowsForTesting("https://en.wikipedia.org/wiki/List_of_2025_albums", html);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            albumWikilink: "",
            albumName: "Murder During Drug Traffic",
            artistName: "Boldy James and RichGains",
            releaseYear: 2025,
            releaseMonth: "January",
            releaseDay: 3,
        });
    });

    it("keeps linked cited album rows with their album wikilink", () => {
        const html = `
            <table class="wikitable plainrowheaders">
                <tr><th>Release date</th><th>Artist</th><th>Album</th><th>Genre</th><th>Label</th><th>Ref.</th></tr>
                <tr>
                    <th scope="row">February14</th>
                    <td>Example Artist</td>
                    <td><i><a href="/wiki/Example_Album">Example Album</a></i></td>
                    <td></td>
                    <td>Example Label</td>
                    <td><sup class="reference"><a href="#cite_note-1">[1]</a></sup></td>
                </tr>
            </table>
        `;

        const rows = extractCitedAlbumRowsForTesting("https://en.wikipedia.org/wiki/List_of_2025_albums", html);

        expect(rows).toHaveLength(1);
        expect(rows[0].albumWikilink).toBe("https://en.wikipedia.org/wiki/Example_Album");
    });
});
