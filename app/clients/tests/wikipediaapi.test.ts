import {__private, getAlbumReleaseFromApi} from "app/clients/wikipediaapi";

describe("wikipediaapi album artist identity", () => {
    const rawArtist = "[[Omni (Minus the Bear album)|Omni]]";
    const wikitext = `{{Infobox album
| name = Networker
| type = studio
| artist = ${rawArtist}
| released = {{start date|2019|11|01}}
}}
'''''Networker''''' is the third studio album by American [[post-punk]] band [[Omni (band)|Omni]].

==Critical reception==
{{Music ratings
| rev1 = Exclaim!
| rev2 = Pitchfork
| rev3 = PopMatters
| rev4 = Q
| rev5 = Uncut
}}`;

    it("uses Networker's band link from the lead when its infobox links to an album", async () => {
        const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
            query: {pages: [{
                title: "Networker (album)", pageid: 123,
                revisions: [{slots: {main: {content: wikitext}}}],
            }]},
        }), {headers: {"content-type": "application/json"}}));
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        try {
            const release = await getAlbumReleaseFromApi("https://en.wikipedia.org/wiki/Networker_(album)");
            expect(release).toMatchObject({
                name: "Networker", original_title: "Networker (album)",
                wikilink: "https://en.wikipedia.org/wiki/Networker_(album)",
                artist_name: "Omni", artist_display_name: "Omni",
                artist_wikilink: "https://en.wikipedia.org/wiki/Omni_(band)",
                year: 2019, month: "November", day: 1, number_of_reviews: 5,
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            fetchMock.mockRestore();
            log.mockRestore();
        }
    });

    it("preserves an ordinary artist link even when the lead links to other same-name pages", () => {
        expect(__private.parseArtistNames("[[Omni (band)|Omni]]", wikitext)).toEqual({
            articleName: "Omni", displayName: "Omni",
            artistWikilink: "https://en.wikipedia.org/wiki/Omni_(band)",
        });
    });

    it.each(["Omni (album)", "Omni (Minus the Bear album)", "Omni (EP)", "Omni (single)"])(
        "does not store %s as an artist when no replacement can be established", (target) => {
            expect(__private.parseArtistNames(`[[${target}|Omni]]`)).toEqual({
                articleName: "Omni", displayName: "Omni", artistWikilink: "",
            });
        },
    );

    it("does not guess when the lead has multiple different same-name targets", () => {
        const ambiguous = wikitext.replace("==Critical reception==", "[[Omni (musician)|Omni]]\n==Critical reception==");
        expect(__private.parseArtistNames(rawArtist, ambiguous).artistWikilink).toBe("");
    });

    it("does not take a replacement from references or later sections", () => {
        const noLeadLink = wikitext.replace("[[Omni (band)|Omni]]", "Omni<ref>[[Omni (musician)|Omni]]</ref>")
            + "\n[[Omni (band)|Omni]]";
        expect(__private.parseArtistNames(rawArtist, noLeadLink).artistWikilink).toBe("");
    });
});

describe("wikipediaapi parseReleaseDate", () => {
    it("uses the first date when multiple dates are present on separate lines", () => {
        const result = __private.parseReleaseDate("January 1, 2005\nJanuary 1, 2025");
        expect(result).toEqual({
            year: 2005,
            month: "January",
            day: 1,
        });
    });

    it("uses the first start date template when multiple are present", () => {
        const result = __private.parseReleaseDate(
            "{{start date|2005|1|1|df=yes}}<br>{{start date|2025|1|1|df=yes}}",
        );
        expect(result).toEqual({
            year: 2005,
            month: "January",
            day: 1,
        });
    });

    it("uses the first bullet in plainlist release dates", () => {
        const result = __private.parseReleaseDate(
            "{{plainlist|\n* January 1, 2005\n* January 1, 2025\n}}",
        );
        expect(result).toEqual({
            year: 2005,
            month: "January",
            day: 1,
        });
    });

    it("uses the first line even when later lines are different month/year", () => {
        const result = __private.parseReleaseDate("September 26, 2005 (US)\nMarch 1, 2025 (reissue)");
        expect(result).toEqual({
            year: 2005,
            month: "September",
            day: 26,
        });
    });
});

describe("wikipediaapi normalizeWikiTitle", () => {
    it("does not throw on malformed percent-encoded titles", () => {
        expect(() => __private.normalizeWikiTitle("3%_(group)")).not.toThrow();
        expect(__private.normalizeWikiTitle("3%_(group)")).toBe("3% (group)");
    });

    it("decodes valid percent-encoded titles", () => {
        expect(__private.normalizeWikiTitle("Fran%C3%A7ois_Cheng")).toBe("François Cheng");
    });
});

describe("wikipediaapi normalizeLabelValue", () => {
    it("normalizes list-like label data to a comma-delimited string", () => {
        expect(__private.normalizeLabelValue("{{plainlist|\n* [[DGC Records|DGC]]\n* [[Geffen Records|Geffen]]\n}}"))
            .toBe("DGC, Geffen");
    });
});

describe("wikipediaapi normalizeListValue", () => {
    it("parses bullet-list producer infobox values", () => {
        expect(__private.normalizeListValue("* [[John Congleton]]"))
            .toBe("John Congleton");
    });
});

describe("wikipediaapi normalizeCategoryTitles", () => {
    it("joins category titles into a comma-delimited string without the Category prefix", () => {
        expect(__private.normalizeCategoryTitles([
            {title: "Category:2011 debut albums"},
            {title: "Category:Romeo Santos albums"},
            {title: "Category:Sony Music Latin albums"},
        ])).toBe("2011 debut albums, Romeo Santos albums, Sony Music Latin albums");
    });
});

describe("wikipediaapi getInfoboxValue", () => {
    it("reads indented infobox fields with multiline values", () => {
        const wikitext = `{{Infobox album
  | name = Example
  | label       = * [[Mercury Records|Mercury]]
* [[Cherry Red Records|Cherry Red]] {{small|(2003 reissue)}}
  | genre = Rock
}}`;

        expect(__private.getInfoboxValue(wikitext, "label"))
            .toBe(`* [[Mercury Records|Mercury]]
* [[Cherry Red Records|Cherry Red]] {{small|(2003 reissue)}}`);
    });
});

describe("wikipediaapi collectReviewEvidence", () => {
    it("combines ratings-template and critical-reception citation outlets into one deduplicated count", () => {
        const wikitext = `{{Music ratings
| rev1 = Pitchfork
| rev1Score = 7.6/10
| rev2 = My Indie Blog
| rev2Score = Favorable
}}
==Critical reception==
{{cite web |url=https://www.salon.com/example |title=Review |website=Salon}}
{{cite web |url=https://pitchfork.com/reviews/albums/example |title=Review |website=Pitchfork}}`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(3);
    });

    it("deduplicates repeated outlets across ratings rows and review links", () => {
        const wikitext = `{{Album ratings
| rev1 = Pitchfork
| rev1Score = 8/10 [https://pitchfork.com/reviews/albums/example link]
| rev2 = Pitchfork
| rev2Score = 4/5
}}`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(1);
    });

    it("counts named refs used in critical reception from definitions elsewhere on the page", () => {
        const wikitext = `==Critical reception==
In ''Glide Magazine'', Doug Collette said it was great.<ref name=Glide/>
In ''Rock & Blues Muse'', Hal Horowitz wrote about the album.<ref name="R&B-Muse" />
In ''Bourbon and Vinyl'', Kenneth Corsini wrote about the performance.<ref name='B&V'/>

==References==
<ref name=Glide>{{cite web |url=https://glidemagazine.com/example-album-review/ |title=Review |work=Glide Magazine}}</ref>
<ref name="R&B-Muse">{{cite web |url=https://rockandbluesmuse.com/review/example/ |title=Review |work=Rock & Blues Muse}}</ref>
<ref name='B&V'>{{cite web |url=https://bourbonandvinyl.net/review/example/ |title=Review |work=Bourbon and Vinyl}}</ref>`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(3);
    });

    it("does not treat self-closing named refs as full ref definitions", () => {
        const wikitext = `{{Infobox album
| recorded = Somewhere<ref name="ABC Country"/>
| single1date = March 2025<ref name="WfT">{{cite web |url=https://onyourmarkus.au/example |title=Announcement |website=On Your Mark Us}}</ref>
}}

==Reception==
''ABC Country'' said it was personal.<ref name="ABC Country">{{cite web |url=https://www.abc.net.au/example |title=Review |website=ABC Country}}</ref>
Paul Cashmere from ''Noise11'' said it was confident.<ref>{{cite web |url=https://www.noise11.com/example |title=Review |website=Noise11}}</ref>`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(2);
        expect(result.links).not.toContain("https://onyourmarkus.au/example");
    });

    it("ignores known press-release wire sources from review counts", () => {
        const wikitext = `==Reception==
{{cite web |url=https://www.prnewswire.com/news-releases/example-release-123456789.html |title=Album announcement |website=PR Newswire}}`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(0);
    });

    it("ignores user-generated and retailer sources for review counting", () => {
        const wikitext = `==Reception==
{{cite web |url=https://www.discogs.com/release/12345-Example |title=Discogs listing |website=Discogs}}
{{cite web |url=https://www.amazon.com/dp/B000000000 |title=Amazon listing |website=Amazon}}`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(0);
    });

    it("treats Forbes contributor URLs as unreliable for review counting", () => {
        const wikitext = `==Reception==
{{cite web |url=https://www.forbes.com/sites/examplecontributor/2025/01/02/example-review/ |title=Review |website=Forbes}}`;

        const result = __private.collectReviewEvidence(wikitext);
        expect(result.count).toBe(0);
    });

});
