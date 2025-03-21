export interface Release {
    artist_wikilink: string
    name: string
    producer: string
    type: string
    label: string
    year: number|null,
    month: string,
    day: number|null,
    wikilink: string
}

export interface DBRelease {
    artist_id: number
    title: string
    dateyear: number
    datemonth: number
    dateday: number
    releasetype: string
    label: string
    producer: number
}
