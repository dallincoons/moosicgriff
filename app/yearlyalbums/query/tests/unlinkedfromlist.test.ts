import {extractLinkedAlbumKeysFromYearlyListHtml, isSuggestedLinkAlreadyPresent, yearlyAlbumsUnlinked} from "app/yearlyalbums/query/unlinkedfromlist";
import {getHtml, isMissingArticlePage} from "app/clients/wikipedia";
import {db} from "app/repositories/db";

jest.mock("app/clients/wikipedia", () => ({getHtml: jest.fn(), isMissingArticlePage: jest.fn()}));
jest.mock("app/repositories/db", () => ({db: jest.fn()}));
jest.mock("app/repositories/discography/discography", () => ({
    __esModule: true,
    default: {deleteReleaseByWikilink: jest.fn()},
}));
jest.mock("app/repositories/discographydeadlinks/discographydeadlinks", () => ({
    __esModule: true,
    default: {insertNew: jest.fn()},
}));

describe("yearly.albums.unlinked duplicate suppression", () => {
    it("skips a release suggestion when that album is already linked elsewhere on the yearly page", () => {
        const html = `
            <table class="wikitable plainrowheaders">
                <tr><th>Release date</th><th>Artist</th><th>Album</th><th>Genre</th><th>Label</th><th>Ref.</th></tr>
                <tr>
                    <th scope="row">2026</th>
                    <td><a href="/wiki/Post_Malone">Post Malone</a></td>
                    <td><i><a href="/wiki/The_Eternal_Buzz">The Eternal Buzz</a></i></td>
                    <td></td>
                    <td>Republic, Mercury</td>
                    <td></td>
                </tr>
                <tr>
                    <th scope="row">2026</th>
                    <td><a href="/wiki/Post_Malone">Post Malone</a></td>
                    <td><i>The Eternal Buzz</i></td>
                    <td></td>
                    <td>Republic, Mercury</td>
                    <td></td>
                </tr>
            </table>
        `;
        const linkedAlbumKeys = extractLinkedAlbumKeysFromYearlyListHtml(
            "https://en.wikipedia.org/wiki/List_of_2026_albums",
            html,
        );

        expect(isSuggestedLinkAlreadyPresent("https://en.wikipedia.org/wiki/The_Eternal_Buzz", linkedAlbumKeys)).toBe(true);
        expect(isSuggestedLinkAlreadyPresent("https://en.wikipedia.org/wiki/The_Eternal_Buzz_(album)", linkedAlbumKeys)).toBe(true);
        expect(isSuggestedLinkAlreadyPresent("https://en.wikipedia.org/wiki/Different_Album", linkedAlbumKeys)).toBe(false);
    });
});

describe("yearly.albums.unlinked discovery results", () => {
    const html = `
        <table class="wikitable plainrowheaders">
            <tr><th>Release date</th><th>Artist</th><th>Album</th><th>Genre</th><th>Label</th><th>Ref.</th></tr>
            <tr>
                <th scope="row">January<br/>3</th>
                <td><a href="/wiki/New_Artist">New Artist</a></td>
                <td><i>New Album</i></td><td></td><td></td><td></td>
            </tr>
        </table>
    `;
    const release = {
        title: "New Album", original_title: null,
        artist_name: "New Artist", artist_display_name: null,
        wikilink: "https://en.wikipedia.org/wiki/New_Album",
        artist_wikilink: null,
    };
    let log: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        (getHtml as jest.Mock).mockResolvedValue(html);
        (db as unknown as jest.Mock).mockResolvedValue([]);
        (isMissingArticlePage as jest.Mock).mockResolvedValue(false);
        log = jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => jest.restoreAllMocks());

    it("hides unlinked albums when there are no database releases", async () => {
        await yearlyAlbumsUnlinked("2025");

        const lines = log.mock.calls.map(([line]) => line);
        expect(lines).toEqual(expect.arrayContaining([
            "[yearly.albums.unlinked] suggestions=0/1",
            "[yearly.albums.unlinked] without_suggestion=1",
        ]));
        expect(lines.some((line) => /^(Month|Album|Artist|Artist Link|Suggested Link|Source):/.test(line))).toBe(false);
        expect(isMissingArticlePage).not.toHaveBeenCalled();
    });

    it("hides an artist mismatch instead of suggesting another artist's same-title album", async () => {
        (db as unknown as jest.Mock).mockResolvedValue([{...release, artist_name: "Different Artist"}]);

        await yearlyAlbumsUnlinked("2025");

        expect(log).not.toHaveBeenCalledWith("Artist: New Artist");
        expect(log).not.toHaveBeenCalledWith("Album: New Album");
        expect(log).not.toHaveBeenCalledWith("Suggested Link: (none)");
        expect(log).not.toHaveBeenCalledWith(`Suggested Link: ${release.wikilink}`);
        expect(isMissingArticlePage).not.toHaveBeenCalled();
    });

    it("still validates and suggests a release when both album and artist match", async () => {
        (db as unknown as jest.Mock).mockResolvedValue([release]);

        await yearlyAlbumsUnlinked("2025");

        expect(isMissingArticlePage).toHaveBeenCalledWith(release.wikilink);
        expect(log).toHaveBeenCalledWith(`Suggested Link: ${release.wikilink}`);
        expect(log).toHaveBeenCalledWith("Source: releases");
        expect(log).toHaveBeenCalledWith("[yearly.albums.unlinked] suggestions=1/1");
        expect(log).toHaveBeenCalledWith("[yearly.albums.unlinked] without_suggestion=0");
    });

    it("shows only matched albums when the 2026 lists also contain unmatched rows", async () => {
        (getHtml as jest.Mock).mockResolvedValueOnce(html.replace("</table>", `
            <tr>
                <th scope="row">February<br/>4</th>
                <td>Unknown Artist</td><td><i>Unmatched Album</i></td><td></td><td></td><td></td>
            </tr>
        </table>`)).mockResolvedValueOnce("<html></html>");
        (db as unknown as jest.Mock).mockResolvedValue([release]);

        await yearlyAlbumsUnlinked("2026");

        expect(getHtml).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenCalledWith("Month: January");
        expect(log).toHaveBeenCalledWith("Album: New Album");
        expect(log).toHaveBeenCalledWith(`Suggested Link: ${release.wikilink}`);
        expect(log).not.toHaveBeenCalledWith("Month: February");
        expect(log).not.toHaveBeenCalledWith("Album: Unmatched Album");
        expect(log).not.toHaveBeenCalledWith("Suggested Link: (none)");
        expect(log).toHaveBeenCalledWith("[yearly.albums.unlinked] suggestions=1/2");
        expect(log).toHaveBeenCalledWith("[yearly.albums.unlinked] without_suggestion=1");
    });

    it("hides a matching release if its album page is missing", async () => {
        (db as unknown as jest.Mock).mockResolvedValue([release]);
        (isMissingArticlePage as jest.Mock).mockResolvedValue(true);

        await yearlyAlbumsUnlinked("2025");

        expect(isMissingArticlePage).toHaveBeenCalledWith(release.wikilink);
        expect(log).not.toHaveBeenCalledWith("Album: New Album");
        expect(log).not.toHaveBeenCalledWith(`Suggested Link: ${release.wikilink}`);
        expect(log).not.toHaveBeenCalledWith("Month: January");
        expect(log).toHaveBeenCalledWith("[yearly.albums.unlinked] suggestions=0/1");
    });

    it("hides a matching release if its page redirects to the artist", async () => {
        (db as unknown as jest.Mock).mockResolvedValue([{
            ...release, artist_wikilink: "https://en.wikipedia.org/wiki/New_Artist",
        }]);
        jest.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({query: {pages: [{title: "New Artist"}]}}),
        } as Response);

        await yearlyAlbumsUnlinked("2025");

        expect(log).not.toHaveBeenCalledWith("Album: New Album");
        expect(log).not.toHaveBeenCalledWith(`Suggested Link: ${release.wikilink}`);
        expect(log).toHaveBeenCalledWith("[yearly.albums.unlinked] skipped_artist_redirects=1");
    });
});
