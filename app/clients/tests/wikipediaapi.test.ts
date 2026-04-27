import {__private} from "app/clients/wikipediaapi";

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
