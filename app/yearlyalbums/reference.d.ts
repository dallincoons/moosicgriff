export interface YearlyAlbumReference {
    album_name: string;
    album_wikilink: string;
    wikipedia_page_id: number | null;
    release_year: number | null;
    release_month: string;
    release_day: number | null;
    genre: string;
    record_label: string;
    source_list_wikilink: string;
}
