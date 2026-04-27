export interface Release {
    artist_wikilink: string
    artist_name: string
    artist_display_name: string
    name: string
    original_title: string
    producer: string
    studio: string
    type: string
    label: string
    original_labels_text: string
    original_categories_text: string
    genre: string
    original_genre: string
    recorded: string
    year: number|null,
    month: string,
    day: number|null,
    wikilink: string
    wikipedia_page_id?: number | null
    number_of_reviews: number
    review_links: string
}

export interface DBRelease {
    id: number
    artist_wikilink: string
    artist_name: string
    artist_display_name?: string | null
    wikilink: string
    wikipedia_page_id?: number | null
    title: string
    original_title?: string | null
    dateyear: number | null
    datemonth: string
    dateday: number | null
    releasetype: string
    original_releasetype?: string | null
    label: string
    original_labels_text?: string | null
    original_categories_text?: string | null
    genre?: string | null
    original_genre?: string | null
    labels_last_scraped_at?: string | null
    categories_last_scraped_at?: string | null
    producer_last_scraped_at?: string | null
    recorded?: string | null
    studio?: string | null
    producer: string
    content_hash?: string | null
    reviews_parse_version?: number | null
    number_of_reviews: number
    manual_number_of_reviews?: number | null
    review_links?: string | null
}
