import {isSkippableWikipediaHref, shouldProcessEntry} from "app/yearlyalbums/syncmatch";
import {extractAlbumEntriesFromYearlyListHtml} from "app/yearlyalbums/listparser";

describe("yearlyalbums sync shouldProcessEntry", () => {
    it("accepts when artist wikilink is present in artists index", () => {
        const ok = shouldProcessEntry(
            "https://en.wikipedia.org/wiki/Mark_Pritchard_(musician)",
            "https://en.wikipedia.org/wiki/Tall_Tales_(Mark_Pritchard_and_Thom_Yorke_album)",
            new Set(["https://en.wikipedia.org/wiki/mark_pritchard_(musician)"]),
            new Set<string>(),
            new Map<string, string>(),
        );

        expect(ok).toBe(true);
    });

    it("accepts when artist differs but album wikilink exists in releases year index", () => {
        const ok = shouldProcessEntry(
            "https://en.wikipedia.org/wiki/Mark_Pritchard_(music_producer)",
            "https://en.wikipedia.org/wiki/Tall_Tales_(Mark_Pritchard_and_Thom_Yorke_album)",
            new Set(["https://en.wikipedia.org/wiki/mark_pritchard_(musician)"]),
            new Set<string>(),
            new Map<string, string>([
                [
                    "https://en.wikipedia.org/wiki/tall_tales_(mark_pritchard_and_thom_yorke_album)",
                    "https://en.wikipedia.org/wiki/mark_pritchard_(musician)",
                ],
            ]),
        );

        expect(ok).toBe(true);
    });

    it("rejects when neither artist nor album are known", () => {
        const ok = shouldProcessEntry(
            "https://en.wikipedia.org/wiki/Unknown_Artist",
            "https://en.wikipedia.org/wiki/Unknown_Album",
            new Set(["https://en.wikipedia.org/wiki/known_artist"]),
            new Set(["https://en.wikipedia.org/wiki/another_known_artist"]),
            new Map<string, string>(),
        );

        expect(ok).toBe(false);
    });

    it("accepts when artist link is missing but album wikilink exists in releases year index", () => {
        const ok = shouldProcessEntry(
            "",
            "https://en.wikipedia.org/wiki/I%27m_Wide_Awake,_It%27s_Morning",
            new Set<string>(),
            new Set<string>(),
            new Map<string, string>([
                [
                    "https://en.wikipedia.org/wiki/i'm_wide_awake,_it's_morning",
                    "https://en.wikipedia.org/wiki/bright_eyes_(band)",
                ],
            ]),
        );

        expect(ok).toBe(true);
    });
});

describe("yearlyalbums sync href filters", () => {
    it("keeps valid album titles that include a colon", () => {
        const shouldSkip = isSkippableWikipediaHref("/wiki/Midnight_Sun:_Girls_Trip");
        expect(shouldSkip).toBe(false);
    });

    it("skips namespace links", () => {
        const shouldSkip = isSkippableWikipediaHref("/wiki/Category:2026_albums");
        expect(shouldSkip).toBe(true);
    });

    it("keeps protocol-relative Wikipedia article links from current HTML", () => {
        const shouldSkip = isSkippableWikipediaHref("//en.wikipedia.org/wiki/Midnight_Sun:_Girls_Trip");
        expect(shouldSkip).toBe(false);
    });

    it("skips section anchors", () => {
        const shouldSkip = isSkippableWikipediaHref("/wiki/Zara_Larsson#Discography");
        expect(shouldSkip).toBe(true);
    });
});

describe("yearlyalbums list parser", () => {
    it("parses rowspanned artist rows when a navigation row precedes the real table header", () => {
        const html = `
            <table class="wikitable plainrowheaders">
                <tr><th colspan="6">Go to: January | February | May | Back to top</th></tr>
                <tr>
                    <th>Date</th>
                    <th>Artist</th>
                    <th>Album</th>
                    <th>Genre</th>
                    <th>Label</th>
                    <th>Ref.</th>
                </tr>
                <tr>
                    <th scope="row" rowspan="3" style="text-align:center;">May<br/>15</th>
                    <td>49 Winchester</td>
                    <td><i><a href="/wiki/Change_of_Plans_(album)">Change of Plans</a></i></td>
                    <td>Alternative country</td>
                    <td>MCA Nashville</td>
                    <td></td>
                </tr>
                <tr>
                    <th scope="row" rowspan="3" style="text-align:left;"><a href="/wiki/Drake_(musician)">Drake</a></th>
                    <td><i><a href="/wiki/Habibti_(album)">Habibti</a></i></td>
                    <td>R&amp;B</td>
                    <td>OVO, Republic</td>
                    <td></td>
                </tr>
                <tr>
                    <td><i><a href="/wiki/Iceman_(album)">Iceman</a></i></td>
                    <td>Hip-hop</td>
                    <td>OVO, Republic</td>
                    <td></td>
                </tr>
                <tr>
                    <td><i><a href="/wiki/Maid_of_Honour_(album)">Maid of Honour</a></i></td>
                    <td>Dance</td>
                    <td>OVO, Republic</td>
                    <td></td>
                </tr>
            </table>
        `;

        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/List_of_2026_albums", html);
        const drakeEntries = entries.filter((entry) => entry.artistWikilink === "https://en.wikipedia.org/wiki/Drake_(musician)");

        expect(drakeEntries.map((entry) => entry.albumName)).toEqual([
            "Habibti",
            "Iceman",
            "Maid of Honour",
        ]);
        expect(drakeEntries.map((entry) => entry.albumWikilink)).toEqual([
            "https://en.wikipedia.org/wiki/Habibti_(album)",
            "https://en.wikipedia.org/wiki/Iceman_(album)",
            "https://en.wikipedia.org/wiki/Maid_of_Honour_(album)",
        ]);
        expect(drakeEntries.map((entry) => `${entry.releaseMonth} ${entry.releaseDay}`)).toEqual([
            "May 15",
            "May 15",
            "May 15",
        ]);
    });

    it("parses protocol-relative article links emitted by current Wikipedia HTML", () => {
        const html = `
            <table class="wikitable plainrowheaders">
                <tr><th>Release date</th><th>Artist</th><th>Album</th><th>Genre</th><th>Label</th><th>Ref.</th></tr>
                <tr>
                    <th scope="row">July<br/>3</th>
                    <td><a href="//en.wikipedia.org/wiki/Deep_Purple">Deep Purple</a></td>
                    <td><i><a href="//en.wikipedia.org/wiki/Splat!">Splat!</a></i></td>
                    <td></td>
                    <td>Earmusic</td>
                    <td></td>
                </tr>
            </table>
        `;

        const entries = extractAlbumEntriesFromYearlyListHtml("https://en.wikipedia.org/wiki/List_of_2026_albums", html);

        expect(entries).toHaveLength(1);
        expect(entries[0].artistWikilink).toBe("https://en.wikipedia.org/wiki/Deep_Purple");
        expect(entries[0].albumWikilink).toBe("https://en.wikipedia.org/wiki/Splat!");
        expect(entries[0].releaseMonth).toBe("July");
        expect(entries[0].releaseDay).toBe(3);
    });
});
