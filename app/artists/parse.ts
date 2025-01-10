import { Artist } from 'app/artists/artist';

export function parseArtists(rawContents: string, parentArtist: Artist): Artist[] {
    let pattern = /\[(.*?)[\s-]*?(?:\(.+\))?(?:Wikipedia)?\]\((.+)\)/g

    let matches = [...rawContents.matchAll(pattern)];

    if (!matches) {
        return [];
    }

    return matches.filter(function(m) {
        return m[2].startsWith("https");
    }).map(function(m) {
        let name = m[1];

        let link: string = m[2];
        let patternWiki = /https:\/\/en.wikipedia.org\/wiki\/(.+)/g;
        let matches = patternWiki.exec(link);
        if (matches && matches.length > 1) {
            name = matches[1].toString().replaceAll("_", " ");
        }

        let patternWikiBand = /(\w+) \((?:[American|British])*\s*band\)/g;
        matches = patternWikiBand.exec(name);
        if (matches && matches.length > 1) {
            name = matches[1];
        }

        return {
            name: decodeURI(name),
            url: m[2],
            graph: {
                parentUrl: parentArtist.url,
            }
        }
    })
}
