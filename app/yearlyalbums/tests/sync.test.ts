import {shouldProcessEntry} from "app/yearlyalbums/syncmatch";

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
