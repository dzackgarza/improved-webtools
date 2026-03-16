import { fetchYoutubeTranscriptMarkdown } from "../../../src/webfetch-handlers/domains/youtube.ts";
import { expect, test } from "bun:test";

test("sanitize stderr strips YTDLP_COOKIES_FILE and sensitive paths", async () => {
    process.env.YTDLP_COOKIES_FILE = "/home/user/my_secret_cookies.txt";

    const output = await fetchYoutubeTranscriptMarkdown({
        url: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        runCommand: async () => ({
            stdoutText: "",
            stderrText: "Error! /home/user/my_secret_cookies.txt not found. Also checked /etc/config.json and /var/www/secret/auth.json.",
            exitCode: 1,
        }),
    });

    expect(output.content).toContain("[REDACTED_COOKIES_PATH]");
    expect(output.content).toContain("[REDACTED_PATH]");
    expect(output.content).not.toContain("/home/user/my_secret_cookies.txt");
    expect(output.content).not.toContain("/etc/config.json");
    expect(output.content).not.toContain("/var/www/secret/auth.json");
    expect(output.content).not.toContain("secret");
});
