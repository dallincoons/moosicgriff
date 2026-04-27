import * as fs from "fs";
import * as path from "path";

export async function releasesMissingLabelCategoryCleanupEmpty(dirArg?: string): Promise<void> {
    const targetDir = (dirArg || "tmp").trim();
    if (!targetDir) {
        console.log('[releases.categories.missing.label.cleanup.empty] invalid directory');
        return;
    }

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        console.log(`[releases.categories.missing.label.cleanup.empty] directory_not_found=${targetDir}`);
        return;
    }

    const entries = fs.readdirSync(targetDir);
    const reportFiles = entries
        .filter((name) => name.endsWith("_missing_category_albums.txt"))
        .map((name) => path.join(targetDir, name));

    let deleted = 0;
    let kept = 0;
    let unreadable = 0;

    for (const filePath of reportFiles) {
        try {
            const content = fs.readFileSync(filePath, "utf8");
            const match = content.match(/^Missing Category Count:\s*(\d+)\s*$/m);
            if (!match) {
                kept += 1;
                continue;
            }

            const count = parseInt(match[1], 10);
            if (Number.isNaN(count) || count > 0) {
                kept += 1;
                continue;
            }

            fs.unlinkSync(filePath);
            deleted += 1;
            console.log(`[releases.categories.missing.label.cleanup.empty] deleted=${filePath}`);
        } catch (e) {
            unreadable += 1;
            console.log(`[releases.categories.missing.label.cleanup.empty] unreadable=${filePath}`);
        }
    }

    console.log(
        `[releases.categories.missing.label.cleanup.empty] scanned=${reportFiles.length} deleted=${deleted} kept=${kept} unreadable=${unreadable}`,
    );
}
