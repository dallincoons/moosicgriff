import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {spawn} from "node:child_process";
import {closeSshSockets, createSshSocket, sshArguments} from "app/repositories/sshsocket";

jest.mock("node:child_process", () => ({spawn: jest.fn()}));

describe("SSH database transport", () => {
    afterEach(() => { closeSshSockets(); jest.clearAllMocks(); });

    it("uses trusted noninteractive SSH without a shell or a local listening port", () => {
        const args = sshArguments("forge@142.93.6.169", "127.0.0.1", 55432);
        expect(args).toContain("StrictHostKeyChecking=yes");
        expect(args).toContain("BatchMode=yes");
        expect(args.slice(-3)).toEqual(["-W", "127.0.0.1:55432", "forge@142.93.6.169"]);
        expect(args).not.toContain("-L");
    });

    it("rejects unsafe destinations and non-loopback database endpoints", () => {
        for (const destination of ["-oProxyCommand=evil", "forge@host;ls", "forge@host\nls"]) {
            expect(() => sshArguments(destination, "127.0.0.1", 55432)).toThrow();
        }
        expect(() => sshArguments("forge@host", "0.0.0.0", 5432)).toThrow();
        expect(() => sshArguments("forge@host", "127.0.0.1", 0)).toThrow();
    });

    function fakeChild() {
        const child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
            exitCode: null, kill: jest.fn(),
        });
        (spawn as jest.Mock).mockReturnValue(child);
        return child;
    }

    it("relays database bytes and closes the SSH child on shutdown", async () => {
        const child = fakeChild();
        const socket = createSshSocket("forge@host", "127.0.0.1", 55432);
        const received = new Promise(resolve => socket.once("data", resolve));
        child.stdout.write(Buffer.from("postgres reply"));
        expect(await received).toEqual(Buffer.from("postgres reply"));
        socket.write("postgres query");
        expect(child.stdin.read().toString()).toBe("postgres query");
        closeSshSockets();
        expect(child.kill).toHaveBeenCalledTimes(1);
        socket.on("error", () => {});
        const closed = new Promise(resolve => socket.once("close", resolve));
        socket.destroy();
        await closed;
    });

    it("surfaces SSH failure instead of using a local connection", async () => {
        const child = fakeChild();
        const socket = createSshSocket("forge@host", "127.0.0.1", 55432);
        const error = new Promise<Error>(resolve => socket.once("error", resolve));
        child.stderr.write("Permission denied");
        child.emit("close", 255);
        expect((await error).message).toContain("Permission denied");
        expect(spawn).toHaveBeenCalledTimes(1);
    });
});
