import postgres from "postgres";
import {DB_STRING} from "config";

export const db = postgres(DB_STRING);

export async function closeDb(): Promise<void> {
    await db.end({ timeout: 5 });
}
