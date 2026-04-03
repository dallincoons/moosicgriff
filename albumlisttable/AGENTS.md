# Album Table Edit Instructions

These instructions define how to add an album row to yearly Wikipedia album list tables (for example `List_of_2005_albums`) and return usable wikitext.

## Goal

Given an album and artist, produce the exact wikitext day block with the album inserted in the correct date section, with valid table structure.

## Workflow

1. Fetch raw page wikitext from Wikipedia API (`action=query`, `prop=revisions`, `rvprop=content`, `rvslots=main`, `format=json`).
   - Regeneration rule: whenever asked to regenerate with new albums, always pull a fresh raw wikitext copy first (do not reuse a stale local snapshot).
2. Locate the target date row:
   - Pattern: `! scope="row" rowspan="N" style="text-align:center;" | Month<br/>Day`
3. Extract the full day block:
   - Start at the target day header row.
   - End immediately before the next day header row.
4. Insert one album row inside the target day block using valid row separators:
   - Keep existing row boundary `|-` lines intact.
   - New row insertion shape must be `...existing row...\n|-\n<new row>\n|-\n...next row or next day header...`.
5. Increment that day header `rowspan` by `+1`.
6. Preserve existing formatting exactly:
   - Keep `|` column order as `Artist`, `Album`, `Genre`, `Label`, `Ref`.
   - Keep blank ref cell as `| ` when no citation is provided.
   - Keep existing whitespace and line style consistent with the page.
   - Do not trim trailing whitespace on untouched lines.
7. Prefer canonical wikilinks:
   - Artist cell should use artist page link (for example `[[TVXQ]]`).
   - Album cell should use piped disambiguated target when needed (for example `''[[Rising Sun (TVXQ album)|Rising Sun]]''`).
   - Label/genre should use existing page naming conventions from nearby rows.
   - Genre limit rule:
     - If source has 1-3 genres, include them as listed.
     - If source has more than 3 genres, include only the first genre.
     - Use the genres from the album's Wikipedia page/list row when available; do not replace a known 1-3 genre set with a single inferred generic genre.
     - Genre casing rule: capitalize the first genre in the list; use lowercase for all subsequent genres in that same genre list.
8. Ordering rule:
   - Default to alphabetical insertion by artist within that day block.
   - Use artist display text (the rendered part, not link target) for ordering, case-insensitive.
   - Treat `Various artists` as a normal artist value under `V` for ordering.
   - If the user asks to append or preserve position, follow that instead.
9. User style lock rule:
   - If the user explicitly corrects wikitext tokens (capitalization, piped links, genre link targets, label text), preserve those exact tokens on future edits unless the user asks to change them again.
10. Return the full updated day block in wikitext.
11. If requested, write the snippet to a local file under `tmp/` (for example `tmp/september12_2005.wikitext`).
12. Release date parsing rule (album pages):
   - When multiple release dates are present, use only the first release date in source order.
   - Ignore all subsequent release dates for year/month/day extraction.

## Safety Checks

- Do not alter any other day block.
- Preserve existing row order except where required by the ordering rule above.
- Do not change unrelated links, refs, or templates.
- Confirm `rowspan` matches the number of album rows under that day header.
- Confirm there are no whitespace-only diffs outside inserted/updated lines.

## Output Contract

When asked for an update:
- Provide only the updated day block unless the user asks for more context.
- If uncertain about date placement, ask before editing.
