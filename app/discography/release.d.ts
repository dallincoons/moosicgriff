export interface Release {
    name: string
    producer: string
    type: string
    label: string
    year: number
    wikilink: string
}

export interface DBRelease {
    artist_id: number
    releasename: string
    releaseyear: string
    releasetype: string
    releaselabel: string
    producer: number
}
