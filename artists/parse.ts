import Artist from 'artists/artist.ts';

export function parseArtists(rawContents: string, depth: number): Artist[] {
    let pattern = /\[(.*?)[\s-]*?(?:\(.+\))?(?:Wikipedia)?\]\((.+)\)/g

    let matches = [...rawContents.matchAll(pattern)];

    if (!matches) {
        return [];
    }

    return matches.filter(function(m) {
        return m[2].startsWith("https");
    }).
    map(function(m) {
        return {
            name: m[1],
            url: m[2],
            graph: {
                depth: depth+1
            }
        }
    })
}
