export interface Label {
    wikilink: string;
    wikipedia_page_id?: number | null;
    name: string;
    founded: string;
    country_of_origin: string;
    genre: string;
    founder: string;
}

export interface DBLabel extends Label {
    id: number;
    last_scraped_at: string;
}
