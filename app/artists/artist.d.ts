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
    page_content_hash?: string | null,
    peers_scraped_at?: string | null,
    discography_wikilink?: string | null,
    discography_content_hash?: string | null,
    discography_scraped_at?: string | null,
    wikipedia_page_id?: number | null,
    has_missing_release_wikilinks?: boolean,
}
