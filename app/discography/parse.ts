import {Artist} from "../artists/artist";
import {Release} from "app/discography/release";

export function parseReleases(rawContents: string): Release[] {
    let pattern = /\*\*(.+)\*\*\n.+Producer:\s*(.+).*\n.+Type of release:\s*(.+)\n.+Label(?:s)*: (.+)\n.+Year released:\s*(.+)(?:\n.+\((https.+)\))?/g

    let matches = [...rawContents.matchAll(pattern)];

    console.log({matches});

    if (!matches) {
        return [];
    }

    return matches.map(function(match) {
        return{
                name: <string>match[1],
                producer: <string>match[2],
                type: <string>match[3],
                label: <string>match[4],
                year: parseInt(match[5]),
                wikilink: <string>match[6] ?? "",
            }
    });
}
