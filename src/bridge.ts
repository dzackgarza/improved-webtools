import {
  executeWebFetch,
  executeWebSearch,
  formatDoctorReport,
  runDoctor,
  type DoctorReport,
  type WebFetchArgs,
  type WebSearchArgs,
} from "./operations.ts";

type BridgeStatus = "ok" | "action_required" | "error";

type BridgeResponse = {
  command: "fetch" | "search" | "doctor";
  status: BridgeStatus;
  text: string;
  doctor?: DoctorReport;
};

function printAndExit(response: BridgeResponse, exitCode = 0): never {
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exit(exitCode);
}

function parsePayload<T>(raw: string | undefined): T {
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const rawPayload = process.argv[3];

  try {
    if (command === "fetch") {
      const text = await executeWebFetch(parsePayload<WebFetchArgs>(rawPayload));
      printAndExit({ command, status: "ok", text });
    }

    if (command === "search") {
      const text = await executeWebSearch(parsePayload<WebSearchArgs>(rawPayload));
      printAndExit({ command, status: "ok", text });
    }

    if (command === "doctor") {
      const doctor = await runDoctor();
      printAndExit({
        command,
        status: doctor.ok ? "ok" : "action_required",
        text: formatDoctorReport(doctor),
        doctor,
      });
    }

    printAndExit(
      {
        command: "doctor",
        status: "error",
        text: `Unknown command: ${JSON.stringify(command)}. Expected one of: fetch, search, doctor.`,
      },
      1,
    );
  } catch (error) {
    printAndExit(
      {
        command: command === "fetch" || command === "search" || command === "doctor" ? command : "doctor",
        status: "error",
        text: error instanceof Error ? error.message : String(error),
      },
      1,
    );
  }
}

await main();
