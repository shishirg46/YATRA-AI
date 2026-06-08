import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const containerName = process.env.DB_CONTAINER_NAME ?? "yatra-postgres";
const host = process.env.DB_HOST ?? "127.0.0.1";
const port = Number(process.env.DB_PORT ?? "5433");
const image = process.env.DB_IMAGE ?? "docker.io/postgis/postgis:16-3.4";
const podmanDataHome =
  process.env.PODMAN_XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");

const podmanEnv = {
  ...process.env,
  XDG_DATA_HOME: podmanDataHome,
};

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: command === "podman" ? podmanEnv : process.env,
    stdio: options.quiet ? "pipe" : "inherit",
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function podman(args, options) {
  return run("podman", args, options);
}

function waitForPort(timeoutMs = 30_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });

      socket.once("connect", () => {
        socket.end();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for Postgres at ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 750);
      });
    };

    attempt();
  });
}

function createContainer() {
  console.log(`[db] Creating ${containerName} from ${image}...`);
  const result = podman([
    "run",
    "--name",
    containerName,
    "-e",
    "POSTGRES_USER=yatra",
    "-e",
    "POSTGRES_PASSWORD=yatra123",
    "-e",
    "POSTGRES_DB=yatraai",
    "-p",
    "5433:5432",
    "-d",
    image,
  ]);

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startContainer() {
  const start = podman(["start", containerName], { quiet: true });
  if (start.status === 0) {
    console.log(`[db] Started ${containerName}.`);
    return;
  }

  const startOutput = output(start);
  if (startOutput.includes("database configuration mismatch")) {
    console.log("[db] Podman storage moved; running podman system migrate...");
    const migrate = podman(["system", "migrate"]);
    if (migrate.status !== 0) {
      process.exit(migrate.status ?? 1);
    }

    const retry = podman(["start", containerName], { quiet: true });
    if (retry.status === 0) {
      console.log(`[db] Started ${containerName} after migration.`);
      return;
    }

    process.stderr.write(output(retry));
    process.exit(retry.status ?? 1);
  }

  if (
    startOutput.includes("no container with name") ||
    startOutput.includes("no such container") ||
    startOutput.includes("does not exist")
  ) {
    createContainer();
    return;
  }

  process.stderr.write(startOutput);
  process.exit(start.status ?? 1);
}

startContainer();

try {
  console.log(`[db] Waiting for Postgres at ${host}:${port}...`);
  await waitForPort();
  console.log("[db] Postgres is ready.");
} catch (error) {
  console.error(`[db] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
