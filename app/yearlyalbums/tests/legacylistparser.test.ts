import {extractAlbumEntriesFromYearlyListHtml} from "app/yearlyalbums/listparser";
import {buildYearlyAlbumSourcePages} from "app/yearlyalbums/sourcepages";

const album = (name: string, artist = `${name} artist`, notes = "-") =>
    `<td><i><a href="/wiki/${name}_album">${name}</a></i></td><td><a href="/wiki/${artist.replace(/ /g, "_")}">${artist}</a></td><td>${notes}</td>`;
const headers = '<tr><th colspan="2">Date</th><th>Album</th><th>Artist</th><th>Notes</th></tr>';
const table = `<table class="wikitable">
    <tr><th colspan="5">January–March navigation</th></tr>${headers}
    <tr><td rowspan="4">J<br> A<br> N<br> U<br> A<br> R<br> Y</td><td rowspan="2">7</td>${album("First", "First artist", "EP")}</tr>
    <tr>${album("Second")}</tr>
    <tr><td>10</td>${album("Third", "Third artist", "Compilation")}</tr>
    <tr><td>Unknown</td>${album("Undated")}</tr>
    <tr><td rowspan="2">F<br>E<br>B<br>R<br>U<br>A<br>R<br>Y</td><td rowspan="2">3</td>${album("Fourth")}</tr>
    <tr>${album("Fifth")}</tr>
</table>`;
const outside = `<table class="wikitable">${headers}<tr><td>March</td><td>1</td>${album("Outside")}</tr></table>`;

describe("older music-year album tables", () => {
    it.each([2003, 2004])("selects the legacy source for %s", year => {
        expect(buildYearlyAlbumSourcePages(year)).toEqual([`https://en.wikipedia.org/wiki/${year}_in_music`]);
    });

    it.each([
        ['<h2><span class="mw-headline" id="Albums_released">Albums released</span></h2>', '<h2>Popular songs</h2>'],
        ['<div class="mw-heading mw-heading2"><h2 id="Albums_released">Albums released</h2></div>', '<div class="mw-heading mw-heading2"><h2>Popular songs</h2></div>'],
    ])("expands month/day spans and Date colspan within the Albums released section: %s", (heading, end) => {
        const html = `<div id="mw-content-text"><div class="mw-parser-output">
            <h2>Events</h2>${outside}${heading}<h3>January–March</h3><div>${table}</div>${end}${outside}
        </div></div>`;
        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music#Albums_released", html);
        expect(entries.map(row => [row.albumName, row.releaseMonth, row.releaseDay])).toEqual([
            ["First", "January", 7], ["Second", "January", 7], ["Third", "January", 10],
            ["Undated", "January", null], ["Fourth", "February", 3], ["Fifth", "February", 3],
        ]);
        expect(entries[0]).toEqual({
            albumName: "First", artistWikilink: "https://en.wikipedia.org/wiki/First_artist",
            albumWikilink: "https://en.wikipedia.org/wiki/First_album", releaseYear: 2003,
            releaseMonth: "January", releaseDay: 7, genre: "", recordLabel: "",
        });
        expect(entries.every(row => row.genre === "" && row.recordLabel === "")).toBe(true);
    });

    it("accounts for unlinked album rows when carrying month and day spans", () => {
        const html = '<h2>Albums released</h2>' + table.replace('<a href="/wiki/First_album">First</a>', 'First');
        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2004_in_music", html);
        expect(entries[0]).toMatchObject({albumName: "Second", releaseMonth: "January", releaseDay: 7});
        expect(entries.find(row => row.albumName === "Fourth")).toMatchObject({releaseMonth: "February", releaseDay: 3});
    });

    it("carries artist spans independently of month and day cells", () => {
        const shared = `<table class="wikitable">${headers}
            <tr><td rowspan="2">January</td><td rowspan="2">7</td><td><a href="/wiki/First_album">First</a></td><td rowspan="2"><a href="/wiki/Shared_artist">Shared artist</a></td><td>EP</td></tr>
            <tr><td><a href="/wiki/Second_album">Second</a></td><td>Live</td></tr></table>`;
        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music", '<h2>Albums released</h2>' + shared);
        expect(entries).toHaveLength(2);
        expect(entries.every(row => row.artistWikilink === "https://en.wikipedia.org/wiki/Shared_artist" && row.releaseDay === 7)).toBe(true);
    });

    it("keeps payload columns aligned when live month/day rowspan counts are wrong", () => {
        const html = '<h2>Albums released</h2>' + table.replace('rowspan="4"', 'rowspan="1"').replace('rowspan="2">7', 'rowspan="1">7');
        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music", html);
        expect(entries.map(row => row.albumName)).toEqual(["First", "Second", "Third", "Undated", "Fourth", "Fifth"]);
        expect(entries[1]).toMatchObject({artistWikilink: "https://en.wikipedia.org/wiki/Second_artist", releaseMonth: "January", releaseDay: 7});
        expect(entries[4]).toMatchObject({releaseMonth: "February", releaseDay: 3});
    });

    it("resets date spans at quarter boundaries", () => {
        const secondQuarter = `<table class="wikitable">${headers}<tr><td>April</td><td>1</td>${album("April")}</tr></table>`;
        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music", '<h2>Albums released</h2>' + table + '<h3>April–June</h3>' + secondQuarter);
        expect(entries.at(-1)).toMatchObject({albumName: "April", releaseMonth: "April", releaseDay: 1});
    });

    it("reads explicit genre/label columns without treating Notes as either", () => {
        const html = '<h2>Albums released</h2><table class="wikitable"><tr><th colspan="2">Date</th><th>Album</th><th>Artist</th><th>Genre</th><th>Label</th><th>Notes</th></tr>'
            + `<tr><td>January</td><td>7</td>${album("First").replace('<td>-</td>', '<td>Rock</td><td>Example Records</td><td>EP</td>')}</tr></table>`;
        expect(extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music", html)[0]).toMatchObject({genre: "Rock", recordLabel: "Example Records"});
    });

    it("also records linked albums in Release date unknown, without borrowing dates or reading chart lists", () => {
        const html = '<h2>Albums released</h2>' + table + '<h2 id="Release_date_unknown">Release date unknown</h2>'
            + '<ul><li><i><a href="/wiki/Unknown_album">Unknown</a></i> – <a href="/wiki/Artist">Artist</a><sup class="reference"><a href="#cite1">[1]</a></sup></li>'
            + '<li><i>Unlinked album</i> – <a href="/wiki/Other_artist">Other artist</a></li></ul>'
            + '<h2>Top albums</h2><ul><li><i><a href="/wiki/Chart_album">Chart album</a></i> – <a href="/wiki/Artist">Artist</a></li></ul>';
        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music", html);
        expect(entries).toHaveLength(7);
        expect(entries.at(-1)).toEqual({albumName: "Unknown", albumWikilink: "https://en.wikipedia.org/wiki/Unknown_album",
            artistWikilink: "https://en.wikipedia.org/wiki/Artist", releaseYear: 2003,
            releaseMonth: "", releaseDay: null, genre: "", recordLabel: ""});
    });

    it("fails visibly when the album section is missing or has no supported tables", () => {
        for (const html of ['<h2>Events</h2>' + outside, '<h2>Albums released</h2><h2>Popular songs</h2>' + outside]) {
            expect(() => extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/2003_in_music", html)).toThrow(/Albums released section/);
        }
    });
});
