export interface Artist {
    readonly name: string
    readonly url: string
    graph: {
        readonly parentUrl: string
    }
}

export interface DBArtist {
    id: number,
    artistname: string,
    wikilink: string,
    found_peers: boolean,
    parent_wikilink: string,
}
