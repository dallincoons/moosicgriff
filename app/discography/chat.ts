import {OPEN_API_API_KEY} from "../../config";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY
});

export async function getDiscographyFromArtists(content: string): Promise<string> {
    const response = await openai.chat.completions.create({
        messages: [
            {
                role: "user",
                content: `list all the music releases for this artist, 
                with the name of the release, the producer, the type of release, the integer year, full name of month, and integer day of the release, 
                and wikipedia links if available \n Example format:
                    - Release name: Nevermind
                    - Producer: Butch Vig
                    - Type of release: Studio Album
                    - Label: DGC
                    - Year released: 1991
                    - Month released: December
                    - Day released: 31
                    - Link to Wikipedia Page: [Nevermind](https://en.wikipedia.org/wiki/Nevermind)
                Don't use asterisks in the response.
                
                If Year, Month, Day are unknown or unspecified, just leave them blank.
                
                Use this content to create the response:
                ${content}`,
            },
        ],
        model: "gpt-4o",
    });

    if (!response || !response.choices || !response.choices[0]!.message) {
        return "";
    }

    return response.choices[0].message.content!.toString();
}
