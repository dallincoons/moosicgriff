import {db} from "./db";
import {DB_SSH_HOST} from "config";

export async function printDatabaseStatus(): Promise<void> {
    const [status] = await db`
        SELECT current_database() AS database, current_user AS username,
               current_setting('transaction_read_only') AS read_only,
               (SELECT count(*) FROM artists) AS artists,
               (SELECT count(*) FROM labels) AS labels,
               (SELECT count(*) FROM releases) AS releases
    `;
    console.log(`[db.status] database=${status.database} user=${status.username} ssh=${DB_SSH_HOST || "none"} read_only=${status.read_only}`);
    console.log(`[db.status] artists=${status.artists} labels=${status.labels} releases=${status.releases}`);
}
